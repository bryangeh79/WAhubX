import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../executor.interface';
import { BaileysService } from '../../baileys/baileys.service';
import { SlotsService } from '../../slots/slots.service';
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
    // 2026-04-26 · Class A · groupAcceptInvite 是 baileys-only API · 必须保留
    // 但 sendText 走 SlotsService facade · isOnline 也走 facade
    // chromium 模式下整个 executor 早 skip (chromium runtime 没实现 group invite 链路)
    private readonly baileys: BaileysService,
    private readonly slots: SlotsService,
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
    // 2026-04-26 · Class A · chromium runtime 没实现 group invite 链路 · 早 skip 不死任务
    if (this.slots.getCurrentMode() === 'chromium') {
      ctx.log('skip-chromium-not-supported', true, {});
      return {
        success: false,
        errorCode: 'NOT_SUPPORTED',
        errorMessage: '当前 RUNTIME_MODE=chromium · join_group 通过邀请链接尚未实现 (留 D11+)',
      };
    }
    const slot = await this.slotRepo.findOne({ where: { accountId: ctx.accountId } });
    if (!slot) {
      return { success: false, errorCode: 'SLOT_NOT_FOUND', errorMessage: '槽位未找到' };
    }

    if (!(await this.slots.isOnline(slot.id))) {
      return { success: false, errorCode: 'NOT_ONLINE', errorMessage: '槽位未在线' };
    }

    try {
      // 1. 预览 (可选但推荐) · Phase 2 · 走 baileys.groupGetInviteInfo facade
      let preview: { subject: string; size: number } | null = null;
      try {
        preview = await this.baileys.groupGetInviteInfo(slot.id, payload.inviteCode);
        if (preview) ctx.log('group-preview', true, preview);
      } catch (e) {
        ctx.log('group-preview-failed', false, { err: String(e) });
      }

      ctx.throwIfPaused?.();

      // 2. 加群
      const groupJid = await this.baileys.groupAcceptInvite(slot.id, payload.inviteCode);
      if (!groupJid) {
        return { success: false, errorCode: 'JOIN_FAILED', errorMessage: '加群返回空 jid · 可能邀请过期/满员' };
      }
      ctx.log('group-joined', true, { groupJid, ...(preview ?? {}) });

      ctx.throwIfPaused?.();

      // 3. 加入后动作 · 延迟 60-180s 再打招呼 (防识别)
      if (payload.postJoinSendText) {
        const delaySec = 60 + Math.floor(Math.random() * 120);
        this.logger.log(`join_group ${ctx.task.id} 加群 OK · 延迟 ${delaySec}s 后发欢迎`);
        await new Promise((r) => setTimeout(r, delaySec * 1000));
        ctx.throwIfPaused?.();
        // 2026-04-26 · Class A · sendText 走 SlotsService facade (虽然进到这分支必是 baileys 模式)
        await this.slots.sendText(slot.id, groupJid, payload.postJoinSendText);
        ctx.log('post-join-hello-sent', true, {});
      }

      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, errorCode: 'JOIN_FAILED', errorMessage: msg };
    }
  }
}
