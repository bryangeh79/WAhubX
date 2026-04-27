import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../executor.interface';
import { BaileysService } from '../../baileys/baileys.service';
import { SlotsService } from '../../slots/slots.service';
import { AccountSlotEntity } from '../../slots/account-slot.entity';

// 2026-04-22 · 批量刷 status · 真实装 · 从 StatusCache 捞 · 快速 readMessages
// payload: { maxItems?: number, dwellMinMs?: number, dwellMaxMs?: number }
// 目的 · 引流 · 让对方 status viewer 列表出现自己
@Injectable()
export class StatusBrowseBulkExecutor implements TaskExecutor {
  readonly taskType = 'status_browse_bulk';
  readonly allowedInNightWindow = false;

  private readonly logger = new Logger(StatusBrowseBulkExecutor.name);

  constructor(
    // 2026-04-26 · Class A · readMessages 是 baileys-only · isOnline 走 facade · chromium 早 skip
    private readonly baileys: BaileysService,
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
    const dwellMaxMs = Math.max(payload.dwellMaxMs ?? 5000, dwellMinMs);

    const slot = await this.slotRepo.findOne({ where: { accountId: ctx.accountId } });
    if (!slot) return { success: false, errorCode: 'SLOT_NOT_FOUND', errorMessage: '槽位未找到' };
    if (!(await this.slots.isOnline(slot.id))) return { success: false, errorCode: 'NOT_ONLINE', errorMessage: '槽位未在线' };

    // 2026-04-26 · D11 · chromium 模式走 wa-web facade · 一气浏览 N 条 (跟 StatusBrowseExecutor 对齐)
    if (this.slots.getCurrentMode() === 'chromium') {
      const dwellMs = Math.max(dwellMinMs, 2000);
      try {
        const r = await this.slots.browseStatuses(slot.id, { maxItems, dwellMs });
        ctx.log('chromium-bulk-browse-done', true, { viewed: r.viewed, total: maxItems });
        return { success: true, errorMessage: `批量浏览 ${r.viewed} 条` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log('chromium-bulk-browse-failed', false, { error: msg });
        return { success: false, errorCode: 'BROWSE_FAILED', errorMessage: msg };
      }
    }

    const cache = this.baileys.getStatusCache();
    if (!cache) {
      return { success: true, errorMessage: 'StatusCache 未初始化' };
    }
    const statuses = cache.list(ctx.accountId, { onlyUnviewed: true, limit: maxItems });
    if (statuses.length === 0) {
      ctx.log('empty-cache', true, {});
      return { success: true, errorMessage: '缓存为空 · 无 status 可刷' };
    }

    let viewed = 0;
    for (const item of statuses) {
      ctx.throwIfPaused?.();
      try {
        // 2026-04-25 · Phase 2 · 通过 baileys.readMessages facade · 自动走 worker
        await this.baileys.readMessages(slot.id, [
          {
            remoteJid: item.key.remoteJid ?? 'status@broadcast',
            id: item.key.id ?? '',
            fromMe: item.key.fromMe ?? false,
            participant: item.key.participant ?? undefined,
          },
        ]);
        cache.markViewed(ctx.accountId, item.key);
        viewed++;
      } catch (err) {
        ctx.log('view-failed', false, { err: err instanceof Error ? err.message : String(err) });
      }
      const dwell = dwellMinMs + Math.random() * (dwellMaxMs - dwellMinMs);
      await new Promise((r) => setTimeout(r, dwell));
    }
    this.logger.log(`status_browse_bulk ${ctx.task.id} · slot ${slot.id} · viewed ${viewed}/${statuses.length}`);
    ctx.log('bulk-browse-done', true, { viewed, total: statuses.length });
    return { success: true, errorMessage: `批量浏览 ${viewed} 条` };
  }
}
