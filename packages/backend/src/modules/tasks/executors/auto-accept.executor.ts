import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../executor.interface';
import { SlotsService } from '../../slots/slots.service';
import { AccountSlotEntity } from '../../slots/account-slot.entity';
import { WarmupPlanEntity, WarmupPhase } from '../../warmup/warmup-plan.entity';
import { WaContactEntity } from '../../baileys/wa-contact.entity';
import { ChatMessageEntity } from '../../baileys/chat-message.entity';

// 2026-04-22 · auto_accept 真实装
// WA 没 "好友请求" 概念 · 此 executor 实际语义:
// "对最近收到陌生号消息的人 · 自动回欢迎语 · 打开对话 · 等同于'接受联系请求'"
//
// payload: {
//   maxDaily?: number,
//   intervalMinSec?: number, intervalMaxSec?: number,
//   welcomeTexts?: string[],   // 随机选一条 · 默认马来华语模板
//   requiresInbound?: boolean, // 只回有入境消息的 (默认 true · 避免主动骚扰)
// }
// §B.7 Phase 上限裁剪 · Day1-3=0 / Day4-7=5 / Day8-14=15 / Day29+=30
@Injectable()
export class AutoAcceptExecutor implements TaskExecutor {
  readonly taskType = 'auto_accept';
  readonly allowedInNightWindow = false;

  private readonly logger = new Logger(AutoAcceptExecutor.name);

  constructor(
    // 2026-04-26 · Class A · SlotsService.sendText facade · chromium-aware
    private readonly slots: SlotsService,
    @InjectRepository(AccountSlotEntity)
    private readonly slotRepo: Repository<AccountSlotEntity>,
    @InjectRepository(WarmupPlanEntity)
    private readonly warmupRepo: Repository<WarmupPlanEntity>,
    @InjectRepository(WaContactEntity)
    private readonly contactRepo: Repository<WaContactEntity>,
  ) {}

  async execute(ctx: TaskExecutorContext): Promise<TaskExecutorResult> {
    const payload = (ctx.task.payload ?? {}) as {
      maxDaily?: number;
      intervalMinSec?: number;
      intervalMaxSec?: number;
      welcomeTexts?: string[];
      requiresInbound?: boolean;
    };

    const slot = await this.slotRepo.findOne({ where: { accountId: ctx.accountId } });
    if (!slot) return { success: false, errorCode: 'SLOT_NOT_FOUND', errorMessage: '槽位未找到' };
    // 2026-04-26 · Class A · 通过 SlotsService.sendText facade · chromium-aware

    // Phase 裁剪
    const plan = await this.warmupRepo.findOne({ where: { accountId: ctx.accountId } });
    const phase = plan?.currentPhase ?? WarmupPhase.Incubate;
    const phaseCaps: Record<WarmupPhase, number> = {
      [WarmupPhase.Incubate]: 0,
      [WarmupPhase.Preheat]: 5,
      [WarmupPhase.Activate]: 15,
      [WarmupPhase.Mature]: 30,
    };
    const phaseCap = phaseCaps[phase as WarmupPhase] ?? 0;
    const userCap = Math.min(payload.maxDaily ?? 10, 50);
    const cap = Math.min(userCap, phaseCap);
    if (cap === 0) {
      ctx.log('phase-cap-zero', true, { phase });
      return { success: true, errorMessage: `当前 Phase ${phase} 禁止自动接受` };
    }
    const intMin = Math.max(payload.intervalMinSec ?? 60, 30);
    const intMax = Math.max(payload.intervalMaxSec ?? 300, intMin);
    const requiresInbound = payload.requiresInbound !== false;

    // 捞"可接受"候选 · 有入境消息 · 但我方没回过 · 且只看个人号 (排除群和 channel)
    const candidates = await this.findCandidates(ctx.accountId, cap, requiresInbound);
    if (candidates.length === 0) {
      ctx.log('no-candidates', true, {});
      return { success: true, errorMessage: '没有可接受的陌生号' };
    }

    const texts = (payload.welcomeTexts && payload.welcomeTexts.length > 0)
      ? payload.welcomeTexts
      : [
          '你好 · 请问哪里找来的我?',
          'Hi · 请问是?',
          '你好 😊',
          'Hello · 有什么可以帮你?',
          '你好 · 请问怎么称呼?',
        ];

    let accepted = 0;
    for (const contact of candidates) {
      ctx.throwIfPaused?.();
      if (accepted >= cap) break;
      const text = texts[Math.floor(Math.random() * texts.length)];
      try {
        await this.slots.sendText(slot.id, contact.remoteJid, text);
        await this.contactRepo.update(contact.id, {
          lastMessageAt: new Date(),
        });
        accepted++;
        ctx.log('accepted', true, { jid: contact.remoteJid, text });
      } catch (err) {
        ctx.log('accept-failed', false, {
          jid: contact.remoteJid,
          err: err instanceof Error ? err.message : String(err),
        });
      }
      const wait = (intMin + Math.random() * (intMax - intMin)) * 1000;
      await new Promise((r) => setTimeout(r, wait));
    }

    this.logger.log(
      `auto_accept ${ctx.task.id} · slot ${slot.id} · accepted ${accepted}/${candidates.length} (cap=${cap})`,
    );
    return { success: true, errorMessage: `接受 ${accepted} 个陌生号` };
  }

  /**
   * 候选 = 陌生号 (个人号) + 最近 7 天有入境消息 + 我方从未回过
   * 简化查询: wa_contact 个人号 (remote_jid 含 @s.whatsapp.net) 且 last_message_at 在 7 天内
   *          但我们没发过 out 消息到该 contact
   */
  private async findCandidates(
    accountId: number,
    limit: number,
    requiresInbound: boolean,
  ): Promise<WaContactEntity[]> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const qb = this.contactRepo
      .createQueryBuilder('c')
      .where('c.account_id = :accId', { accId: accountId })
      .andWhere('c.remote_jid LIKE :suffix', { suffix: '%@s.whatsapp.net' });

    if (requiresInbound) {
      qb.andWhere('c.last_message_at >= :since', { since: sevenDaysAgo });
    }

    qb.andWhere((qb2) => {
      const sub = qb2
        .subQuery()
        .select('1')
        .from(ChatMessageEntity, 'm')
        .where('m.account_id = c.account_id')
        .andWhere('m.contact_id = c.id')
        .andWhere("m.direction = 'out'")
        .getQuery();
      return `NOT EXISTS (${sub})`;
    });

    return qb.orderBy('c.last_message_at', 'DESC').limit(limit).getMany();
  }
}
