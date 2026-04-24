import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../executor.interface';
import { BaileysService } from '../../baileys/baileys.service';
import { AccountSlotEntity } from '../../slots/account-slot.entity';
import { ChatMessageEntity, MessageDirection } from '../../baileys/chat-message.entity';
import { WaContactEntity } from '../../baileys/wa-contact.entity';

// 2026-04-22 · A7 · 自动回复 (被动)
// 扫最近 N 小时内 · 有入境消息 · 我方没回过的 contact
// 挑 K 个 · 按配置的 text 模板自然回复 (或 AI rewrite)
// §B.2 Day 3 "被动回复启用"
//
// payload: {
//   lookbackHours?: number,  // 扫近 N 小时的入境
//   maxReplies?: number,     // 本次最多回几个
//   templates?: string[],    // 回复模板 (随机选)
//   minIntervalSec?: number, maxIntervalSec?: number,
// }
@Injectable()
export class AutoReplyExecutor implements TaskExecutor {
  readonly taskType = 'auto_reply';
  readonly allowedInNightWindow = false;

  private readonly logger = new Logger(AutoReplyExecutor.name);

  constructor(
    private readonly baileys: BaileysService,
    @InjectRepository(AccountSlotEntity)
    private readonly slotRepo: Repository<AccountSlotEntity>,
    @InjectRepository(ChatMessageEntity)
    private readonly msgRepo: Repository<ChatMessageEntity>,
    @InjectRepository(WaContactEntity)
    private readonly contactRepo: Repository<WaContactEntity>,
  ) {}

  async execute(ctx: TaskExecutorContext): Promise<TaskExecutorResult> {
    const payload = (ctx.task.payload ?? {}) as {
      lookbackHours?: number;
      maxReplies?: number;
      templates?: string[];
      minIntervalSec?: number;
      maxIntervalSec?: number;
    };
    const lookbackHours = Math.min(payload.lookbackHours ?? 4, 24);
    const maxReplies = Math.min(payload.maxReplies ?? 10, 30);
    const templates = (payload.templates && payload.templates.length > 0)
      ? payload.templates
      : [
          '收到 ✓',
          '好的 🙂',
          '嗯',
          'OK',
          '稍等我看看',
          '你好 · 请问?',
          '在呢',
        ];
    const intMin = Math.max(payload.minIntervalSec ?? 20, 10);
    const intMax = Math.max(payload.maxIntervalSec ?? 90, intMin);

    const slot = await this.slotRepo.findOne({ where: { accountId: ctx.accountId } });
    if (!slot) return { success: false, errorCode: 'SLOT_NOT_FOUND', errorMessage: '槽位未找到' };
    const sock = this.baileys.getSocket(slot.id);
    if (!sock) return { success: false, errorCode: 'NOT_ONLINE', errorMessage: '槽位 socket 未在线' };

    const since = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
    // 查 · 最近 N 小时内有入境消息 · 但入境消息之后我方没回过 的 contact
    // 简化: 捞每个 contact 最近消息 · 若 direction=in 且 sentAt >= since → 需要回
    const recentInbound = await this.msgRepo
      .createQueryBuilder('m')
      .where('m.account_id = :aid', { aid: ctx.accountId })
      .andWhere('m.direction = :dir', { dir: MessageDirection.In })
      .andWhere('m.sent_at >= :since', { since })
      .orderBy('m.sent_at', 'DESC')
      .limit(maxReplies * 5) // 多捞点 · 下面去重
      .getMany();

    // 按 contact_id group · 只取每个 contact 最新的入境
    const latestByContact = new Map<number, ChatMessageEntity>();
    for (const m of recentInbound) {
      if (!latestByContact.has(m.contactId)) latestByContact.set(m.contactId, m);
    }

    let replied = 0;
    for (const [contactId, lastInbound] of latestByContact.entries()) {
      if (replied >= maxReplies) break;
      ctx.throwIfPaused?.();
      // 检查我方是否在 lastInbound 之后回过
      const myLastOut = await this.msgRepo
        .createQueryBuilder('m')
        .where('m.account_id = :aid AND m.contact_id = :cid', {
          aid: ctx.accountId,
          cid: contactId,
        })
        .andWhere('m.direction = :dir', { dir: MessageDirection.Out })
        .orderBy('m.sent_at', 'DESC')
        .getOne();
      if (myLastOut && lastInbound.sentAt && myLastOut.sentAt && myLastOut.sentAt > lastInbound.sentAt) {
        continue; // 已回
      }
      // 跳过群和频道
      const contact = await this.contactRepo.findOne({ where: { id: contactId } });
      if (!contact) continue;
      if (contact.remoteJid.endsWith('@g.us') || contact.remoteJid.endsWith('@newsletter')) continue;

      const text = templates[Math.floor(Math.random() * templates.length)];
      try {
        await sock.sendMessage(contact.remoteJid, { text });
        replied++;
        ctx.log('auto-replied', true, { jid: contact.remoteJid, text });
      } catch (err) {
        ctx.log('reply-failed', false, {
          jid: contact.remoteJid,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      const wait = (intMin + Math.random() * (intMax - intMin)) * 1000;
      await new Promise((r) => setTimeout(r, wait));
    }

    this.logger.log(
      `auto_reply ${ctx.task.id} · slot ${slot.id} · replied ${replied}/${latestByContact.size}`,
    );
    return { success: true, errorMessage: `自动回复 ${replied} 条` };
  }
}
