import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../executor.interface';
import { SlotsService } from '../../slots/slots.service';
import { AccountSlotEntity } from '../../slots/account-slot.entity';

// 2026-04-28 · Phase D · chromium-only · 走 SlotsService.reactStatuses facade
@Injectable()
export class StatusReactExecutor implements TaskExecutor {
  readonly taskType = 'status_react';
  readonly allowedInNightWindow = false;

  private readonly logger = new Logger(StatusReactExecutor.name);

  constructor(
    private readonly slots: SlotsService,
    @InjectRepository(AccountSlotEntity)
    private readonly slotRepo: Repository<AccountSlotEntity>,
  ) {}

  async execute(ctx: TaskExecutorContext): Promise<TaskExecutorResult> {
    const payload = (ctx.task.payload ?? {}) as { maxPerDay?: number; emoji?: string };
    const maxPerDay = Math.min(payload.maxPerDay ?? 2, 5);
    const emoji = payload.emoji ?? '👍';

    const slot = await this.slotRepo.findOne({ where: { accountId: ctx.accountId } });
    if (!slot) return { success: false, errorCode: 'SLOT_NOT_FOUND', errorMessage: '槽位未找到' };
    if (!(await this.slots.isOnline(slot.id)))
      return { success: false, errorCode: 'NOT_ONLINE', errorMessage: '槽位未在线' };

    try {
      const r = await this.slots.reactStatuses(slot.id, { maxItems: maxPerDay, emoji });
      ctx.log('status-react-done', true, { reacted: r.reacted, max: maxPerDay });
      this.logger.log(
        `status_react ${ctx.task.id} · slot ${slot.id} · reacted ${r.reacted}/${maxPerDay}`,
      );
      return { success: true, errorMessage: `点赞 ${r.reacted} 条` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log('status-react-failed', false, { error: msg });
      return { success: false, errorCode: 'REACT_FAILED', errorMessage: msg };
    }
  }
}
