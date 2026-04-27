import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../executor.interface';
import { SlotsService } from '../../slots/slots.service';
import { AccountSlotEntity } from '../../slots/account-slot.entity';

// 2026-04-28 · Phase D · chromium-only · 走 SlotsService.browseStatuses facade
@Injectable()
export class StatusBrowseBulkExecutor implements TaskExecutor {
  readonly taskType = 'status_browse_bulk';
  readonly allowedInNightWindow = false;

  private readonly logger = new Logger(StatusBrowseBulkExecutor.name);

  constructor(
    private readonly slots: SlotsService,
    @InjectRepository(AccountSlotEntity)
    private readonly slotRepo: Repository<AccountSlotEntity>,
  ) {}

  async execute(ctx: TaskExecutorContext): Promise<TaskExecutorResult> {
    const payload = (ctx.task.payload ?? {}) as {
      maxItems?: number;
      dwellMinMs?: number;
      dwellMaxMs?: number;
    };
    const maxItems = Math.min(payload.maxItems ?? 30, 50);
    const dwellMinMs = Math.max(payload.dwellMinMs ?? 2000, 1500);

    const slot = await this.slotRepo.findOne({ where: { accountId: ctx.accountId } });
    if (!slot) return { success: false, errorCode: 'SLOT_NOT_FOUND', errorMessage: '槽位未找到' };
    if (!(await this.slots.isOnline(slot.id)))
      return { success: false, errorCode: 'NOT_ONLINE', errorMessage: '槽位未在线' };

    try {
      const r = await this.slots.browseStatuses(slot.id, { maxItems, dwellMs: dwellMinMs });
      ctx.log('bulk-browse-done', true, { viewed: r.viewed, total: maxItems });
      this.logger.log(
        `status_browse_bulk ${ctx.task.id} · slot ${slot.id} · viewed ${r.viewed}/${maxItems}`,
      );
      return { success: true, errorMessage: `批量浏览 ${r.viewed} 条` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.log('bulk-browse-failed', false, { error: msg });
      return { success: false, errorCode: 'BROWSE_FAILED', errorMessage: msg };
    }
  }
}
