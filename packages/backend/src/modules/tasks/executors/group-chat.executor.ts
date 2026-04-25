import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../executor.interface';
import { BaileysService } from '../../baileys/baileys.service';
import { AccountSlotEntity } from '../../slots/account-slot.entity';
import { WaContactEntity } from '../../baileys/wa-contact.entity';

// 2026-04-22 · 群内冒泡 · 每 3-5 天在加的群里说一句 · 避免"潜水号"
// payload: {
//   maxGroups?: number,        // 本次最多 N 群
//   texts?: string[],          // 随机发一条
// }
@Injectable()
export class GroupChatExecutor implements TaskExecutor {
  readonly taskType = 'group_chat';
  readonly allowedInNightWindow = false;

  private readonly logger = new Logger(GroupChatExecutor.name);

  constructor(
    private readonly baileys: BaileysService,
    @InjectRepository(AccountSlotEntity)
    private readonly slotRepo: Repository<AccountSlotEntity>,
    @InjectRepository(WaContactEntity)
    private readonly contactRepo: Repository<WaContactEntity>,
  ) {}

  async execute(ctx: TaskExecutorContext): Promise<TaskExecutorResult> {
    const payload = (ctx.task.payload ?? {}) as {
      maxGroups?: number;
      texts?: string[];
    };
    const maxGroups = Math.min(payload.maxGroups ?? 2, 5);
    const texts = payload.texts ?? [
      '早',
      '好',
      '👍',
      '😊',
      '收到',
      '有道理',
      '不错',
    ];

    const slot = await this.slotRepo.findOne({ where: { accountId: ctx.accountId } });
    if (!slot) return { success: false, errorCode: 'SLOT_NOT_FOUND', errorMessage: '槽位未找到' };
    if (!this.baileys.isSlotOnline(slot.id)) return { success: false, errorCode: 'NOT_ONLINE', errorMessage: '槽位未在线' };

    const groups = await this.contactRepo
      .createQueryBuilder('c')
      .where('c.account_id = :aid', { aid: ctx.accountId })
      .andWhere('c.remote_jid LIKE :s', { s: '%@g.us' })
      .orderBy('RANDOM()')
      .limit(maxGroups)
      .getMany();

    if (groups.length === 0) {
      ctx.log('no-groups', true, {});
      return { success: true, errorMessage: '没加群 · 无群可冒泡' };
    }

    let sent = 0;
    for (const g of groups) {
      ctx.throwIfPaused?.();
      const text = texts[Math.floor(Math.random() * texts.length)];
      try {
        // 2026-04-25 · Phase 2 · 通过 baileys.sendText facade · 自动走 worker
        await this.baileys.sendText(slot.id, g.remoteJid, text);
        sent++;
        ctx.log('group-chat', true, { jid: g.remoteJid, text });
      } catch (err) {
        ctx.log('group-chat-failed', false, {
          err: err instanceof Error ? err.message : String(err),
        });
      }
      await new Promise((r) => setTimeout(r, 30000 + Math.random() * 60000));
    }
    this.logger.log(`group_chat ${ctx.task.id} · slot ${slot.id} · sent ${sent}/${groups.length}`);
    return { success: true, errorMessage: `群内冒泡 ${sent} 条` };
  }
}
