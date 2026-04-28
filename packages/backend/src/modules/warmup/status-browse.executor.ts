import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../tasks/executor.interface';
import { SlotsService } from '../slots/slots.service';
import { AccountSlotEntity } from '../slots/account-slot.entity';

// 2026-04-28 · Phase D · chromium-only · 走 SlotsService.browseStatuses facade
@Injectable()
export class StatusBrowseExecutor implements TaskExecutor {
  readonly taskType = 'status_browse';
  readonly allowedInNightWindow = true;

  private readonly logger = new Logger(StatusBrowseExecutor.name);

  constructor(
    private readonly slots: SlotsService,
    @InjectRepository(AccountSlotEntity)
    private readonly slotRepo: Repository<AccountSlotEntity>,
  ) {}

  async execute(ctx: TaskExecutorContext): Promise<TaskExecutorResult> {
    const payload = (ctx.task.payload ?? {}) as {
      durationMinutes?: number;
      perItemDwellSec?: number;
      maxItems?: number;
    };
    const slot = await this.slotRepo.findOne({ where: { accountId: ctx.accountId } });
    if (!slot) return { success: false, errorCode: 'SLOT_NOT_FOUND', errorMessage: '槽位未找到' };

    const maxItems = Math.min(payload.maxItems ?? 50, 100);
    const dwellMs = Math.max((payload.perItemDwellSec ?? 8) * 1000, 2000);
    try {
      const r = await this.slots.browseStatuses(slot.id, { maxItems, dwellMs });
      ctx.log('status-browse-done', true, { viewed: r.viewed, total: maxItems });
      this.logger.log(
        `status_browse ${ctx.task.id} · slot ${slot.id} · viewed ${r.viewed}/${maxItems}`,
      );
      return { success: true, errorMessage: `浏览 ${r.viewed} 条 status` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log('status-browse-failed', false, { error: msg });
      return { success: false, errorCode: 'BROWSE_FAILED', errorMessage: msg };
    }
  }
}
