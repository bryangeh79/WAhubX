import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../executor.interface';
import { BaileysService } from '../../baileys/baileys.service';
import { AccountSlotEntity } from '../../slots/account-slot.entity';

// 2026-04-21 · F1 自动加群 (批量) · §B.1 / task-scheduler-tab.md
// payload: { inviteCode: string, postJoinSendText?: string }
// Baileys: sock.groupGetInviteInfo(code) 预览 → sock.groupAcceptInvite(code) 加群
@Injectable()
export class JoinGroupExecutor implements TaskExecutor {
  readonly taskType = 'join_group';
  readonly allowedInNightWindow = false;

  private readonly logger = new Logger(JoinGroupExecutor.name);

  constructor(
    private readonly baileys: BaileysService,
    @InjectRepository(AccountSlotEntity)
    private readonly slotRepo: Repository<AccountSlotEntity>,
  ) {}

  async execute(ctx: TaskExecutorContext): Promise<TaskExecutorResult> {
    const payload = (ctx.task.payload ?? {}) as {
      inviteCode?: string;
      postJoinSendText?: string;
      maxDaily?: number;
      intervalMinSec?: number;
      intervalMaxSec?: number;
    };
    if (payload.maxDaily || payload.intervalMinSec) {
      this.logger.log(
        `join_group ${ctx.task.id} · configured maxDaily=${payload.maxDaily ?? 5} interval=${payload.intervalMinSec ?? 900}-${payload.intervalMaxSec ?? 3600}s`,
      );
    }
    if (!payload.inviteCode) {
      return { success: false, errorCode: 'INVALID_PAYLOAD', errorMessage: 'inviteCode 必填' };
    }
    const slot = await this.slotRepo.findOne({ where: { accountId: ctx.accountId } });
    if (!slot) {
      return { success: false, errorCode: 'SLOT_NOT_FOUND', errorMessage: '槽位未找到' };
    }

    if (!this.baileys.isSlotOnline(slot.id)) {
      return { success: false, errorCode: 'NOT_ONLINE', errorMessage: '槽位未在线' };
    }

    try {
      // 2026-04-25 · Phase 2 · 直接走 groupAcceptInvite facade (worker 模式 / 老路径都兼容)
      // 跳过预览 (groupGetInviteInfo) · worker 协议未实装 · 加群成功后取 metadata 也行
      ctx.throwIfPaused?.();

      // 加群
      const groupJid = await this.baileys.groupAcceptInvite(slot.id, payload.inviteCode);
      if (!groupJid) {
        return { success: false, errorCode: 'JOIN_FAILED', errorMessage: '加群返回空 jid · 可能邀请过期/满员' };
      }
      ctx.log('group-joined', true, { groupJid });

      ctx.throwIfPaused?.();

      // 3. 加入后动作 · 延迟 60-180s 再打招呼 (防识别)
      if (payload.postJoinSendText) {
        const delaySec = 60 + Math.floor(Math.random() * 120);
        this.logger.log(`join_group ${ctx.task.id} 加群 OK · 延迟 ${delaySec}s 后发欢迎`);
        await new Promise((r) => setTimeout(r, delaySec * 1000));
        ctx.throwIfPaused?.();
        await this.baileys.sendText(slot.id, groupJid, payload.postJoinSendText);
        ctx.log('post-join-hello-sent', true, {});
      }

      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, errorCode: 'JOIN_FAILED', errorMessage: msg };
    }
  }
}
