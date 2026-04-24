import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../executor.interface';
import { BaileysService } from '../../baileys/baileys.service';
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
    private readonly baileys: BaileysService,
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
    const sock = this.baileys.getSocket(slot.id);
    if (!sock) return { success: false, errorCode: 'NOT_ONLINE', errorMessage: '槽位 socket 未在线' };

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
        await sock.readMessages([item.key]);
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
