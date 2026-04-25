import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../executor.interface';
import { BaileysService } from '../../baileys/baileys.service';
import { AccountSlotEntity } from '../../slots/account-slot.entity';
import { ChannelItemsService } from '../../channel-items/channel-items.service';
import { ChannelItemEntity } from '../../channel-items/channel-item.entity';

// 2026-04-21 · F2 Follow 频道
// 模式:
//   manual  : payload.inviteCode = "ABC" → 只 follow 这 1 个
//   random  : payload.count = 5 → 从素材库随机 follow 5 个
//   by-tag  : payload.count=5 + tags=[forex] → 从 tag 里挑 5 个 follow
// 单任务内循环 · 死 code 自动 disable + 换下一个 · 直到达到 count 或耗尽
@Injectable()
export class FollowChannelExecutor implements TaskExecutor {
  readonly taskType = 'follow_channel';
  readonly allowedInNightWindow = false;

  private readonly logger = new Logger(FollowChannelExecutor.name);

  constructor(
    private readonly baileys: BaileysService,
    @InjectRepository(AccountSlotEntity)
    private readonly slotRepo: Repository<AccountSlotEntity>,
    @InjectRepository(ChannelItemEntity)
    private readonly channelRepo: Repository<ChannelItemEntity>,
    private readonly channelsService: ChannelItemsService,
  ) {}

  async execute(ctx: TaskExecutorContext): Promise<TaskExecutorResult> {
    const payload = (ctx.task.payload ?? {}) as {
      inviteCode?: string;
      channelJid?: string;
      count?: number;
      tags?: string[];
      followMode?: 'random' | 'by-tag' | 'manual';
      intervalMinSec?: number;
      intervalMaxSec?: number;
      maxAttempts?: number; // 总尝试次数 (含失败) · 默认 count × 3
    };

    const slot = await this.slotRepo.findOne({ where: { accountId: ctx.accountId } });
    if (!slot) return { success: false, errorCode: 'SLOT_NOT_FOUND', errorMessage: '槽位未找到' };
    // 2026-04-25 · Phase 2 · 通过 baileys.newsletterMetadata/newsletterFollow facade · 自动走 worker

    const mode = payload.followMode ?? (payload.inviteCode ? 'manual' : 'random');
    const count = Math.min(Math.max(payload.count ?? 1, 1), 20);
    const maxAttempts = payload.maxAttempts ?? count * 3;
    const intMin = Math.max(payload.intervalMinSec ?? 30, 10);
    const intMax = Math.max(payload.intervalMaxSec ?? 180, intMin);

    const tried = new Set<string>();
    const followed: Array<{ code: string; name: string }> = [];
    const failed: Array<{ code: string; reason: string }> = [];

    // manual: 只试 1 个
    if (mode === 'manual') {
      if (!payload.inviteCode) {
        return { success: false, errorCode: 'INVALID_PAYLOAD', errorMessage: 'manual 模式 inviteCode 必填' };
      }
      const outcome = await this.tryFollowOnce(slot.id, payload.inviteCode);
      ctx.log('follow-attempt', outcome.ok, { code: payload.inviteCode, ...outcome });
      if (outcome.ok) {
        return {
          success: true,
          errorMessage: `✓ followed: ${outcome.resolvedName ?? payload.inviteCode}`,
        };
      }
      if (outcome.isDeadCode) {
        await this.channelRepo.update(
          { inviteCode: payload.inviteCode },
          { enabled: false, lastVerifiedAt: new Date() },
        );
      }
      return { success: false, errorCode: outcome.errorCode, errorMessage: outcome.errorMessage };
    }

    // random / by-tag: 循环挑 + follow 到达 count
    let attempt = 0;
    while (followed.length < count && attempt < maxAttempts) {
      ctx.throwIfPaused?.();

      // 挑一个新 code
      const pick = await this.pickOne(ctx.task.tenantId, payload.tags, [...tried]);
      if (!pick) {
        // 素材库已没有可用 (都试过或都 disabled)
        this.logger.warn(
          `follow_channel ${ctx.task.id} · 素材库已无可用频道 (tags=${payload.tags?.join(',') ?? 'any'}) · followed=${followed.length}/${count}`,
        );
        break;
      }
      tried.add(pick.inviteCode);
      attempt++;

      const outcome = await this.tryFollowOnce(slot.id, pick.inviteCode);
      ctx.log(outcome.ok ? 'followed' : 'failed', outcome.ok, {
        code: pick.inviteCode,
        name: pick.name,
        attempt,
        ...outcome,
      });

      if (outcome.ok) {
        followed.push({ code: pick.inviteCode, name: outcome.resolvedName ?? pick.name });
        this.logger.log(
          `follow_channel ${ctx.task.id} · [${followed.length}/${count}] ✓ ${outcome.resolvedName ?? pick.name}`,
        );
      } else {
        failed.push({ code: pick.inviteCode, reason: outcome.errorCode ?? 'unknown' });
        if (outcome.isDeadCode) {
          await this.channelRepo.update(
            { inviteCode: pick.inviteCode },
            { enabled: false, lastVerifiedAt: new Date() },
          );
          this.logger.warn(
            `follow_channel ${ctx.task.id} · 死 code 标 disabled: "${pick.inviteCode}" (${pick.name})`,
          );
        }
        // 账号级问题 (非 dead code) 出现 · 换 code 也没用 · 直接停
        if (!outcome.isDeadCode && outcome.errorCode !== 'FOLLOW_REJECTED') {
          this.logger.warn(`follow_channel ${ctx.task.id} · 账号级错误 "${outcome.errorCode}" · 停重试`);
          break;
        }
      }

      // 成功的 follow 之间加延迟 · 防风控
      if (outcome.ok && followed.length < count) {
        const sleepMs = (intMin + Math.random() * (intMax - intMin)) * 1000;
        await new Promise((r) => setTimeout(r, sleepMs));
      }
    }

    // 结果汇总
    const summary = `成功 follow ${followed.length}/${count} · 尝试 ${attempt} 次 · 死 code ${failed.length}`;
    if (followed.length === count) {
      return {
        success: true,
        errorMessage: `✓ ${summary} · 频道: ${followed.map((f) => f.name).slice(0, 5).join(', ')}${followed.length > 5 ? '...' : ''}`,
      };
    }
    if (followed.length > 0) {
      // 部分成功 · 标成功但错误消息带警告
      return {
        success: true,
        errorMessage: `⚠ 部分完成 · ${summary} (目标未达)`,
      };
    }
    return {
      success: false,
      errorCode: 'ALL_FAILED',
      errorMessage: `${summary} · 全部失败 · 素材库该 tag 下可能都已失效`,
    };
  }

  /**
   * 单次 follow · 返 detailed outcome
   * Baileys 6.7.21 known bug: newsletterFollow 的 WA 服务端响应结构变了 · 会 throw "unexpected response structure"
   * 实际操作可能已成功 · workaround: 报错后 re-fetch metadata · 检查 viewer_metadata.mute 或 subscribers_count
   */
  private async tryFollowOnce(
    slotId: number,
    inviteCode: string,
  ): Promise<{
    ok: boolean;
    jid?: string;
    resolvedName?: string;
    errorCode?: string;
    errorMessage?: string;
    isDeadCode?: boolean;
  }> {
    try {
      // 2026-04-25 · Phase 2 · 通过 baileys.newsletterMetadata/newsletterFollow facade
      const meta = (await this.baileys.newsletterMetadata(slotId, 'invite', inviteCode)) as {
        id?: string;
        name?: string | { text?: string };
        thread_metadata?: { name?: { text?: string } };
        viewer_metadata?: { mute?: string; role?: string } | null;
      } | null;
      if (!meta?.id) {
        return {
          ok: false,
          errorCode: 'INVALID_INVITE',
          errorMessage: `code "${inviteCode}" 无效/已删除`,
          isDeadCode: true,
        };
      }
      const jid = meta.id;
      const resolvedName =
        typeof meta.name === 'string'
          ? meta.name
          : meta.name?.text ?? meta.thread_metadata?.name?.text;

      // 已经在 follow 状态 (历史 follow 过没 unfollow)
      if (meta.viewer_metadata && (meta.viewer_metadata as { role?: string }).role === 'SUBSCRIBER') {
        return { ok: true, jid, resolvedName, errorMessage: '已 follow (先前订阅)' };
      }

      try {
        await this.baileys.newsletterFollow(slotId, jid);
        return { ok: true, jid, resolvedName };
      } catch (followErr: unknown) {
        const e = followErr as { message?: string };
        const msg = e.message ?? String(followErr);

        // Baileys 6.7.21 已知 bug: "unexpected response structure" · follow 可能其实已成功
        // 重试更长 delay · 多次 poll viewer_metadata.role 变化
        if (/unexpected response structure/i.test(msg)) {
          for (let i = 0; i < 3; i++) {
            try {
              await new Promise((r) => setTimeout(r, (i + 1) * 2000)); // 2s, 4s, 6s
              const recheck = (await this.baileys.newsletterMetadata(slotId, 'jid', jid)) as {
                viewer_metadata?: { role?: string; mute?: string } | null;
              } | null;
              const vm = (recheck?.viewer_metadata ?? null) as { role?: string; mute?: string } | null;
              this.logger.log(
                `follow workaround check ${i + 1}/3 · jid=${jid} · viewer=${JSON.stringify(vm)}`,
              );
              if (vm && (vm.role === 'SUBSCRIBER' || vm.role === 'ADMIN' || vm.role === 'OWNER')) {
                return {
                  ok: true,
                  jid,
                  resolvedName,
                  errorMessage: `(Baileys bug · recheck=${vm.role} 确认订阅)`,
                };
              }
            } catch (rcErr: unknown) {
              this.logger.warn(`follow workaround recheck ${i + 1} threw: ${(rcErr as Error).message}`);
            }
          }
          this.logger.warn(
            `follow workaround exhausted · viewer still GUEST · treating as dead code · jid=${jid}`,
          );
        }

        const isDead = /not found|not_found|does not exist|invalid|expired/i.test(msg);
        return {
          ok: false,
          errorCode: 'FOLLOW_REJECTED',
          errorMessage: msg,
          isDeadCode: isDead,
        };
      }
    } catch (metaErr: unknown) {
      const e = metaErr as { message?: string };
      const msg = e.message ?? String(metaErr);
      const isDead = /unexpected response|not found|invalid|expired/i.test(msg);
      return {
        ok: false,
        errorCode: 'METADATA_FAILED',
        errorMessage: `查元数据失败: ${msg}`,
        isDeadCode: isDead,
      };
    }
  }

  private async pickOne(
    tenantId: number,
    tags: string[] | undefined,
    exclude: string[],
  ): Promise<{ inviteCode: string; name: string } | null> {
    const candidates = await this.channelsService.pickRandom(tenantId, {
      tags,
      count: 10,
      onlyGlobal: false,
    });
    for (const c of candidates) {
      if (c.inviteCode && !exclude.includes(c.inviteCode)) {
        return { inviteCode: c.inviteCode, name: c.name };
      }
    }
    return null;
  }
}
