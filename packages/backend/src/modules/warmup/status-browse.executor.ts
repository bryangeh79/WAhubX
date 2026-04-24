import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../tasks/executor.interface';
import { BaileysService } from '../baileys/baileys.service';
import { AccountSlotEntity } from '../slots/account-slot.entity';

// 2026-04-22 · status_browse 真实装
// 从 StatusCacheService 拉最近他人 status · 按时长分页 readMessages · 对方看得到 "你" 的 view
// payload: { durationMinutes?: number, perItemDwellSec?: number, maxItems?: number }
@Injectable()
export class StatusBrowseExecutor implements TaskExecutor {
  readonly taskType = 'status_browse';
  readonly allowedInNightWindow = true;

  private readonly logger = new Logger(StatusBrowseExecutor.name);

  constructor(
    private readonly baileys: BaileysService,
    @InjectRepository(AccountSlotEntity)
    private readonly slotRepo: Repository<AccountSlotEntity>,
  ) {}

  async execute(ctx: TaskExecutorContext): Promise<TaskExecutorResult> {
    const payload = (ctx.task.payload ?? {}) as {
      durationMinutes?: number;
      perItemDwellSec?: number;
      maxItems?: number;
    };
    const durationMs = Math.min(payload.durationMinutes ?? 10, 60) * 60_000;
    const dwellMinMs = Math.max((payload.perItemDwellSec ?? 8) * 1000, 2000);
    const dwellMaxMs = dwellMinMs * 2;
    const maxItems = Math.min(payload.maxItems ?? 50, 100);

    const slot = await this.slotRepo.findOne({ where: { accountId: ctx.accountId } });
    if (!slot) return { success: false, errorCode: 'SLOT_NOT_FOUND', errorMessage: '槽位未找到' };
    const sock = this.baileys.getSocket(slot.id);
    if (!sock) return { success: false, errorCode: 'NOT_ONLINE', errorMessage: '槽位 socket 未在线' };

    const cache = this.baileys.getStatusCache();
    if (!cache) {
      ctx.log('no-cache-service', false, {});
      return { success: true, errorMessage: 'StatusCache 未初始化 · 跳过' };
    }
    const statuses = cache.list(ctx.accountId, { onlyUnviewed: true, limit: maxItems });
    if (statuses.length === 0) {
      ctx.log('no-status-in-cache', true, { hint: '需等 status@broadcast 消息攒 · 新号初期常见' });
      return { success: true, errorMessage: '缓存为空 · 无 status 可浏览' };
    }

    const startedAt = Date.now();
    let viewed = 0;
    for (const item of statuses) {
      ctx.throwIfPaused?.();
      if (Date.now() - startedAt > durationMs) break;
      try {
        await sock.readMessages([item.key]);
        cache.markViewed(ctx.accountId, item.key);
        viewed++;
        ctx.log('status-view', true, { author: item.author, id: item.key.id });
      } catch (err) {
        ctx.log('status-view-failed', false, {
          author: item.author,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      const dwell = dwellMinMs + Math.random() * (dwellMaxMs - dwellMinMs);
      await new Promise((r) => setTimeout(r, dwell));
    }

    this.logger.log(`status_browse ${ctx.task.id} · slot ${slot.id} · viewed ${viewed}/${statuses.length}`);
    return { success: true, errorMessage: `浏览 ${viewed} 条 status` };
  }
}
