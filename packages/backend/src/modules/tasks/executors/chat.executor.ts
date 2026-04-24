import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../executor.interface';
import { BaileysService } from '../../baileys/baileys.service';
import { AccountSlotEntity } from '../../slots/account-slot.entity';

// 2026-04-21 · 重写: 从 M3 stub 升级到真接 Baileys sendText / sendMedia
// payload schema:
//   text 类:  { to, contentType: 'text', text }
//   媒体类:   { to, contentType: 'image'|'video'|'voice'|'file', mediaBase64, mimeType?, filename?, caption? }
//   AI 生成:  { to, contentType: 'text', aiGenerate: true, aiPrompt: '...' } — 目前先走传 text, AI 走 rewrite M6 (后续接)
type ChatContentType = 'text' | 'image' | 'video' | 'voice' | 'file';

interface ChatPayload {
  to?: string;
  contentType?: ChatContentType;
  text?: string;
  mediaBase64?: string;
  mimeType?: string;
  filename?: string;
  caption?: string;
}

@Injectable()
export class ChatExecutor implements TaskExecutor {
  readonly taskType = 'chat';
  readonly allowedInNightWindow = false;

  private readonly logger = new Logger(ChatExecutor.name);

  constructor(
    private readonly baileys: BaileysService,
    @InjectRepository(AccountSlotEntity)
    private readonly slotRepo: Repository<AccountSlotEntity>,
  ) {}

  async execute(ctx: TaskExecutorContext): Promise<TaskExecutorResult> {
    const payload = (ctx.task.payload ?? {}) as ChatPayload;
    const contentType: ChatContentType = payload.contentType ?? 'text';

    if (!payload.to) {
      return { success: false, errorCode: 'INVALID_PAYLOAD', errorMessage: 'to 必填' };
    }

    // 解析 slot from account_id
    const slot = await this.slotRepo.findOne({ where: { accountId: ctx.accountId } });
    if (!slot) {
      return { success: false, errorCode: 'SLOT_NOT_FOUND', errorMessage: `account ${ctx.accountId} 无绑定槽位` };
    }

    ctx.log('chat-prepared', true, { to: payload.to, contentType });
    ctx.throwIfPaused?.();

    try {
      if (contentType === 'text') {
        if (!payload.text) {
          return { success: false, errorCode: 'INVALID_PAYLOAD', errorMessage: 'text 必填' };
        }
        await this.baileys.sendText(slot.id, payload.to, payload.text);
      } else {
        if (!payload.mediaBase64) {
          return { success: false, errorCode: 'INVALID_PAYLOAD', errorMessage: 'mediaBase64 必填' };
        }
        await this.baileys.sendMedia(slot.id, payload.to, contentType, payload.mediaBase64, {
          mimeType: payload.mimeType,
          filename: payload.filename,
          caption: payload.caption,
        });
      }
      ctx.throwIfPaused?.();
      ctx.log('chat-sent', true, { contentType });
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`chat task ${ctx.task.id} failed: ${msg}`);
      return { success: false, errorCode: 'SEND_FAILED', errorMessage: msg };
    }
  }
}
