import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../executor.interface';
import { SlotsService } from '../../slots/slots.service';
import { AccountSlotEntity } from '../../slots/account-slot.entity';

// 2026-04-22 · 主动"加好友" (WA 概念: 主动发第一条消息给未互动过的号)
// payload: {
//   phoneNumbers?: string[],   // 手填手机号列表 (E.164 · 如 60168160836)
//   openingTexts?: string[],   // 开场白模板
//   maxCount?: number,         // 本次最多加几个
//   intervalMinSec?: number, intervalMaxSec?: number,
// }
@Injectable()
export class AddContactExecutor implements TaskExecutor {
  readonly taskType = 'add_contact';
  readonly allowedInNightWindow = false;

  private readonly logger = new Logger(AddContactExecutor.name);

  constructor(
    // 2026-04-26 · Class A · SlotsService.sendText facade · chromium-aware
    private readonly slots: SlotsService,
    @InjectRepository(AccountSlotEntity)
    private readonly slotRepo: Repository<AccountSlotEntity>,
  ) {}

  async execute(ctx: TaskExecutorContext): Promise<TaskExecutorResult> {
    const payload = (ctx.task.payload ?? {}) as {
      phoneNumbers?: string[];
      openingTexts?: string[];
      maxCount?: number;
      intervalMinSec?: number;
      intervalMaxSec?: number;
    };
    const numbers = (payload.phoneNumbers ?? [])
      .map((n) => n.replace(/\D+/g, ''))
      .filter(Boolean);
    if (numbers.length === 0) {
      return { success: true, errorMessage: '无 phoneNumbers · 空过' };
    }
    const maxCount = Math.min(payload.maxCount ?? numbers.length, 20);
    const openings = payload.openingTexts ?? [
      '你好 · 请问是?',
      'Hi · 刚看到你的号 · 想认识一下',
      '你好 😊',
    ];
    const intMin = Math.max(payload.intervalMinSec ?? 60, 30);
    const intMax = Math.max(payload.intervalMaxSec ?? 180, intMin);

    const slot = await this.slotRepo.findOne({ where: { accountId: ctx.accountId } });
    if (!slot) return { success: false, errorCode: 'SLOT_NOT_FOUND', errorMessage: '槽位未找到' };
    // 2026-04-26 · Class A · 通过 SlotsService.sendText facade · chromium-aware

    let added = 0;
    for (const num of numbers.slice(0, maxCount)) {
      ctx.throwIfPaused?.();
      const jid = `${num}@s.whatsapp.net`;
      const text = openings[Math.floor(Math.random() * openings.length)];
      try {
        await this.slots.sendText(slot.id, jid, text);
        added++;
        ctx.log('contact-added', true, { jid });
      } catch (err) {
        ctx.log('add-failed', false, {
          jid,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      const wait = (intMin + Math.random() * (intMax - intMin)) * 1000;
      await new Promise((r) => setTimeout(r, wait));
    }
    this.logger.log(`add_contact ${ctx.task.id} · slot ${slot.id} · added ${added}/${numbers.length}`);
    return { success: true, errorMessage: `主动加 ${added} 号` };
  }
}
