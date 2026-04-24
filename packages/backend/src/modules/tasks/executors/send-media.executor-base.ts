// 2026-04-22 · 发媒体任务通用基类 · send_voice / send_image / send_video 共用
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'node:fs';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../executor.interface';
import { BaileysService } from '../../baileys/baileys.service';
import { AccountSlotEntity } from '../../slots/account-slot.entity';
import { WaContactEntity } from '../../baileys/wa-contact.entity';
import { AssetPoolService } from '../../assets/asset-pool.service';
import { AssetKind } from '../../scripts/asset.entity';

// payload shape:
// {
//   targetJids?: string[],     // 指定 jid 列表 (优先)
//   targetTag?: string,        // 或按 tag 筛 wa_contact (简化 stub · V1 先跳)
//   targetAll?: boolean,       // 给所有个人号联系人 (慎用 · 硬上限)
//   pool?: string,             // 指定池 · 否则全库随机
//   caption?: string,          // 可选 caption
//   maxTargets?: number,       // 上限 · 默认 5
//   intervalMinSec?: number, intervalMaxSec?: number,
// }
export interface SendMediaPayload {
  targetJids?: string[];
  targetTag?: string;
  targetAll?: boolean;
  pool?: string;
  caption?: string;
  maxTargets?: number;
  intervalMinSec?: number;
  intervalMaxSec?: number;
}

@Injectable()
export abstract class SendMediaExecutorBase implements TaskExecutor {
  abstract readonly taskType: string;
  readonly allowedInNightWindow = false;
  protected abstract readonly kind: AssetKind;
  protected abstract readonly mediaType: 'voice' | 'image' | 'video';

  protected readonly logger = new Logger(this.constructor.name);

  constructor(
    protected readonly baileys: BaileysService,
    @InjectRepository(AccountSlotEntity)
    protected readonly slotRepo: Repository<AccountSlotEntity>,
    @InjectRepository(WaContactEntity)
    protected readonly contactRepo: Repository<WaContactEntity>,
    protected readonly assetPool: AssetPoolService,
  ) {}

  async execute(ctx: TaskExecutorContext): Promise<TaskExecutorResult> {
    const payload = (ctx.task.payload ?? {}) as SendMediaPayload;
    const maxTargets = Math.min(payload.maxTargets ?? 5, 20);
    const intMin = Math.max(payload.intervalMinSec ?? 30, 15);
    const intMax = Math.max(payload.intervalMaxSec ?? 120, intMin);

    const slot = await this.slotRepo.findOne({ where: { accountId: ctx.accountId } });
    if (!slot) return { success: false, errorCode: 'SLOT_NOT_FOUND', errorMessage: '槽位未找到' };
    // 2026-04-22 · sock 不在 pool 时尝试 respawn 一次 (DB=active 但 pool 空)
    let sock = this.baileys.getSocket(slot.id);
    if (!sock) {
      ctx.log('sock-missing-respawn', true, {});
      try {
        await this.baileys.reactivateAndRespawn(slot.id);
        await new Promise((r) => setTimeout(r, 3000));
        sock = this.baileys.getSocket(slot.id);
      } catch (err) {
        ctx.log('respawn-failed', false, { err: err instanceof Error ? err.message : String(err) });
      }
    }
    if (!sock) {
      return {
        success: false,
        errorCode: 'NOT_ONLINE',
        errorMessage: '槽位连接不在线 · 自动重连后仍失败 · 请手动点槽位卡 🔄 重连',
      };
    }

    // 挑目标
    const targets = await this.resolveTargets(ctx.accountId, payload, maxTargets);
    if (targets.length === 0) {
      ctx.log('no-targets', true, {});
      return { success: true, errorMessage: '无有效目标' };
    }

    const WA_MEDIA_MAX_BYTES = 16 * 1024 * 1024; // WA 官方 16MB 上限
    let sent = 0;
    for (const jid of targets) {
      ctx.throwIfPaused?.();
      // 每个目标挑 1 个随机素材 · 最多试 3 个 (避开太大的)
      let asset: (Awaited<ReturnType<typeof this.assetPool.pickRandom>>)[number] | null = null;
      let absPath = '';
      const triedIds: number[] = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        const picks = await this.assetPool.pickRandom(this.kind, {
          pool: payload.pool,
          count: 1,
          excludeIds: triedIds,
        });
        if (picks.length === 0) break;
        const candidate = picks[0];
        triedIds.push(candidate.id);
        const candidatePath = this.assetPool.getAbsolutePath(candidate);
        if (!fs.existsSync(candidatePath)) {
          ctx.log('asset-file-missing', false, { id: candidate.id });
          continue;
        }
        const size = fs.statSync(candidatePath).size;
        if (size > WA_MEDIA_MAX_BYTES) {
          ctx.log('asset-too-large', false, {
            id: candidate.id,
            size: Math.round(size / 1024 / 1024) + 'MB',
            limit: '16MB',
          });
          continue; // 换一个
        }
        asset = candidate;
        absPath = candidatePath;
        break;
      }
      if (!asset) {
        ctx.log('no-valid-asset', false, {
          pool: payload.pool,
          hint: '池子里全是 > 16MB 文件 · WA 不接受',
        });
        continue;
      }
      try {
        const buf = fs.readFileSync(absPath);
        const base64 = buf.toString('base64');
        await this.baileys.sendMedia(slot.id, jid, this.mediaType, base64, {
          caption: payload.caption,
        });
        sent++;
        ctx.log('sent', true, { jid, assetId: asset.id, pool: asset.poolName });
      } catch (err) {
        ctx.log('send-failed', false, {
          jid,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      const wait = (intMin + Math.random() * (intMax - intMin)) * 1000;
      await new Promise((r) => setTimeout(r, wait));
    }

    this.logger.log(`${this.taskType} ${ctx.task.id} · slot ${slot.id} · sent ${sent}/${targets.length}`);
    // 2026-04-22 · 全部失败时标 failed · 不能假装成功
    if (sent === 0 && targets.length > 0) {
      return {
        success: false,
        errorCode: 'ALL_SEND_FAILED',
        errorMessage: `${targets.length} 个目标全部发送失败 (看日志详情)`,
      };
    }
    return { success: true, errorMessage: `发送 ${sent}/${targets.length} 条` };
  }

  private async resolveTargets(
    accountId: number,
    payload: SendMediaPayload,
    limit: number,
  ): Promise<string[]> {
    if (payload.targetJids && payload.targetJids.length > 0) {
      return payload.targetJids.slice(0, limit);
    }
    if (payload.targetAll) {
      const contacts = await this.contactRepo
        .createQueryBuilder('c')
        .where('c.account_id = :aid', { aid: accountId })
        .andWhere('c.remote_jid LIKE :s', { s: '%@s.whatsapp.net' })
        .orderBy('RANDOM()')
        .limit(limit)
        .getMany();
      return contacts.map((c) => c.remoteJid);
    }
    return [];
  }
}
