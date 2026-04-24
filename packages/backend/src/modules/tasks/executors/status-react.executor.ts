import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../executor.interface';
import { BaileysService } from '../../baileys/baileys.service';
import { AccountSlotEntity } from '../../slots/account-slot.entity';

// 2026-04-22 · 点赞朋友圈 · 真实装 · 从 StatusCache 挑未点赞 · sendMessage react
// payload: { maxPerDay?: number, emoji?: string }
// §B.2 Day 4 风控 · 每天 1-2 个 · 硬上限 5
@Injectable()
export class StatusReactExecutor implements TaskExecutor {
  readonly taskType = 'status_react';
  readonly allowedInNightWindow = false;

  private readonly logger = new Logger(StatusReactExecutor.name);

  constructor(
    private readonly baileys: BaileysService,
    @InjectRepository(AccountSlotEntity)
    private readonly slotRepo: Repository<AccountSlotEntity>,
  ) {}

  async execute(ctx: TaskExecutorContext): Promise<TaskExecutorResult> {
    const payload = (ctx.task.payload ?? {}) as {
      maxPerDay?: number;
      emoji?: string;
    };
    const maxPerDay = Math.min(payload.maxPerDay ?? 2, 5);
    const emoji = payload.emoji ?? '👍';

    const slot = await this.slotRepo.findOne({ where: { accountId: ctx.accountId } });
    if (!slot) return { success: false, errorCode: 'SLOT_NOT_FOUND', errorMessage: '槽位未找到' };
    const sock = this.baileys.getSocket(slot.id);
    if (!sock) return { success: false, errorCode: 'NOT_ONLINE', errorMessage: '槽位 socket 未在线' };

    const cache = this.baileys.getStatusCache();
    if (!cache) {
      return { success: true, errorMessage: 'StatusCache 未初始化' };
    }
    const statuses = cache.list(ctx.accountId, { onlyUnreacted: true, limit: maxPerDay * 2 });
    if (statuses.length === 0) {
      ctx.log('empty-cache', true, {});
      return { success: true, errorMessage: '缓存为空 · 无 status 可点赞' };
    }

    let reacted = 0;
    for (const item of statuses) {
      if (reacted >= maxPerDay) break;
      ctx.throwIfPaused?.();
      try {
        await sock.sendMessage('status@broadcast', {
          react: { key: item.key, text: emoji },
        });
        cache.markReacted(ctx.accountId, item.key);
        reacted++;
        ctx.log('status-react', true, { author: item.author, emoji });
      } catch (err) {
        ctx.log('status-react-failed', false, {
          err: err instanceof Error ? err.message : String(err),
        });
      }
      // 间隔 30-90s · 防反刷
      const wait = 30000 + Math.random() * 60000;
      await new Promise((r) => setTimeout(r, wait));
    }

    this.logger.log(`status_react ${ctx.task.id} · slot ${slot.id} · reacted ${reacted}/${maxPerDay}`);
    return { success: true, errorMessage: `点赞 ${reacted} 条` };
  }
}
