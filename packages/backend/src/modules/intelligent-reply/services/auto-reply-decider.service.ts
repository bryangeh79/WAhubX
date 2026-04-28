import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  ConversationStage,
  CustomerConversationEntity,
} from '../entities/customer-conversation.entity';
import { PendingInboundEntity } from '../entities/pending-inbound.entity';
import { TenantReplySettingsService } from './tenant-reply-settings.service';
import { ReplyExecutorService } from './reply-executor.service';

// 2026-04-24 · 11 闸门决策流水
// 监听 takeover.message.in · 判断是否触发自动回复 · 若触发则进消息聚合窗 · 8s 后 flush 给 Executor

// 硬编码常量 (不给租户改)
const AGGREGATION_WINDOW_MS = 8000;
// 2026-04-28 · 限速放宽 · 老值太狠 turn-by-turn 客服对话被屏蔽
//   老 30min 只回 1 次 · 客户连问 3 个问题只能答第 1 个 · 体验差
//   新 3s · 仅 debounce 同一 burst (8s 聚合后正常回 turn-by-turn)
//   老 24h 只回 3 次 · 真客户咨询场景动辄 5-10 轮 · 不够
//   新 24h 30 条 · 配合 tenant_reply_settings.daily_ai_reply_limit (默认 200)
//     双层保险: 单对话 30 + 全租户 daily limit
const RATE_DEBOUNCE_MS = 3_000;
const RATE_24H_LIMIT = 30;
const HANDOFF_KEYWORDS_LEVEL1 = [
  '投诉', '退款', '退货', '律师', '报警', '骂', '操', '傻逼', '滚', '垃圾', '骗子',
  'scam', 'refund', 'lawyer', 'sue',
];
const HANDOFF_KEYWORDS_LEVEL2 = [
  '多少钱', '报价', '套餐', '怎么收费', '价格', '价钱', '优惠', '折扣',
  'demo', '试用', '试一下', '合同', '见面', '预约',
];

interface InboundEvent {
  accountId?: number;
  remoteJid?: string;
  direction?: string;
  msgType?: string;
  content?: string | null;
  messageId?: string;
  sentAt?: string;
  // 2026-04-25 · D11-3 · slot 角色 · broadcast 号 inbound 不进 auto-reply
  slotRole?: 'broadcast' | 'customer_service';
}

@Injectable()
export class AutoReplyDeciderService {
  private readonly logger = new Logger(AutoReplyDeciderService.name);

  // Map<conversationId, Timeout> · 聚合窗计时器
  private aggTimers = new Map<number, NodeJS.Timeout>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(CustomerConversationEntity)
    private readonly convRepo: Repository<CustomerConversationEntity>,
    @InjectRepository(PendingInboundEntity)
    private readonly bufRepo: Repository<PendingInboundEntity>,
    private readonly settings: TenantReplySettingsService,
    private readonly executor: ReplyExecutorService,
  ) {}

  @OnEvent('takeover.message.in')
  async onInbound(evt: InboundEvent): Promise<void> {
    try {
      // 闸门 1 · 基础过滤
      if (!evt?.remoteJid || !evt.accountId) return;
      if (evt.remoteJid.includes('@g.us')) return; // 群消息
      if (evt.msgType && evt.msgType !== 'text') return; // 先只处理 text

      // 2026-04-25 · D11-3 · 角色路由门禁 (老 baileys 时代约束)
      // 2026-04-28 · 解除 · chromium per-slot · 任何号都能跑独立 inbound watcher
      // 老限制只放 customer_service · 用户明确要求所有号都可启用
      // 实际是否启用由 tenant_reply_settings.mode 控制 (off/faq/smart)
      // 若用户不想 broadcast 号触发自动回复 · 可在 UI 加 per-slot 开关 (V2)
      if (!evt.slotRole) {
        this.logger.log(
          `auto-reply gate · skip · acc=${evt.accountId} · slotRole=unset (老数据)`,
        );
        return;
      }
      const phone = this.jidToPhone(evt.remoteJid);
      if (!phone) return;
      const content = (evt.content ?? '').trim();
      if (!content) return;

      // 从 account_id 反查 tenant_id + slot_id
      const slotRows = await this.dataSource.query<Array<{ tenant_id: number; slot_id: number }>>(
        `SELECT tenant_id, id as slot_id FROM account_slot WHERE account_id = $1 LIMIT 1`,
        [evt.accountId],
      );
      if (slotRows.length === 0) return;
      const { tenant_id: tenantId, slot_id: slotId } = slotRows[0];

      // 租户设置检查 (闸门 · mode=off 直接 return)
      const settings = await this.settings.get(tenantId);
      if (settings.mode === 'off') return;

      // 确保 customer_conversation 存在
      const conv = await this.ensureConversation(tenantId, slotId, phone);

      // 闸门 3 · 对话状态
      // 2026-04-28 · HandoffRequired 也跳过 · 不再重复发 handoff 消息
      //   bug: 老逻辑只跳 HumanTakeover/DoNotReply/Closed · handoff_required 仍触发
      //        客户连发多条 · 每条都得到一份 "稍后让同事联系" 的 spam
      if (
        conv.stage === ConversationStage.HumanTakeover ||
        conv.stage === ConversationStage.DoNotReply ||
        conv.stage === ConversationStage.Closed ||
        conv.stage === ConversationStage.HandoffRequired
      ) {
        this.logger.debug(`conv ${conv.id} stage=${conv.stage} · 跳过`);
        return;
      }

      // 更新 last_inbound_at
      conv.lastInboundAt = new Date();
      await this.convRepo.save(conv);

      // 闸门 5 · 频率限流
      if (conv.lastAiReplyAt && Date.now() - conv.lastAiReplyAt.getTime() < RATE_DEBOUNCE_MS) {
        this.logger.debug(`conv ${conv.id} · 30min 内已回过 · 跳`);
        return;
      }
      if (conv.aiReplyCount24h >= RATE_24H_LIMIT) {
        this.logger.log(
          `conv ${conv.id} · 24h 已回 ${conv.aiReplyCount24h} 次 · 触发 handoff (一次性提示 + 标 handoff)`,
        );
        conv.stage = ConversationStage.HandoffRequired;
        await this.convRepo.save(conv);
        // 不 silent · 礼貌一次性提示 (不会再答下一条 · stage 已 handoff_required)
        // 用 emit takeover.handoff 让 ReplyExecutor 实装 (本服务不直接发 · 简单做就同事会跟进)
        // 这里 V1 简单 · 后续优化为 send 一次"今日咨询频繁 · 已转专人 · 请稍候" 再 handoff
        return;
      }

      // 闸门 · 夜间静默
      if (settings.quietHoursEnabled) {
        if (this.isInQuietHours(settings.quietHoursStart, settings.quietHoursEnd)) {
          this.logger.debug(`conv ${conv.id} · 静默时段 · 跳`);
          return;
        }
      }

      // 闸门 6 · Handoff 关键词 · 一级立即 handoff
      const lower = content.toLowerCase();
      const customHandoff = (settings.customHandoffKeywords ?? []).map((k) => k.toLowerCase());
      const level1Hit =
        HANDOFF_KEYWORDS_LEVEL1.some((k) => lower.includes(k.toLowerCase())) ||
        customHandoff.some((k) => lower.includes(k));
      if (level1Hit) {
        this.logger.log(`conv ${conv.id} · 一级 handoff 关键词 · 立即转人工`);
        conv.stage = ConversationStage.HandoffRequired;
        await this.convRepo.save(conv);
        return;
      }

      // 闸门 4 · 聚合窗 · 放入 buffer
      await this.bufRepo.save(
        this.bufRepo.create({
          conversationId: conv.id,
          content,
          messageId: evt.messageId ?? null,
        }),
      );

      // 重置/启动 8s 计时器
      const existing = this.aggTimers.get(conv.id);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        this.flushConversation(conv.id).catch((e) =>
          this.logger.warn(`flush conv ${conv.id} failed: ${e}`),
        );
      }, AGGREGATION_WINDOW_MS);
      this.aggTimers.set(conv.id, timer);
    } catch (err) {
      this.logger.warn(`AutoReplyDecider error: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async flushConversation(conversationId: number): Promise<void> {
    this.aggTimers.delete(conversationId);
    // 取所有未 flush 的 buffer
    const bufRows = await this.bufRepo.find({
      where: { conversationId, flushed: false },
      order: { receivedAt: 'ASC' },
    });
    if (bufRows.length === 0) return;
    const merged = bufRows.map((r) => r.content).join('\n');
    // 标记已 flush
    await this.bufRepo.update(
      bufRows.map((r) => r.id),
      { flushed: true },
    );
    // 交给 Executor
    await this.executor.handle(conversationId, merged, bufRows.map((r) => r.messageId ?? ''));
  }

  async ensureConversation(
    tenantId: number,
    slotId: number,
    phoneE164: string,
  ): Promise<CustomerConversationEntity> {
    let conv = await this.convRepo.findOne({
      where: { tenantId, slotId, phoneE164 },
    });
    if (!conv) {
      // 自动归因: 查这号最近 7 天内有没有广告目标
      let lastTargetId: string | null = null;
      let kbId: number | null = null;
      const targetRows = await this.dataSource.query<Array<{ id: string; campaign_id: number; kb_id: number | null }>>(
        `
        SELECT t.id, t.campaign_id, c.knowledge_base_id as kb_id
        FROM campaign_target t
        INNER JOIN campaign c ON c.id = t.campaign_id
        WHERE c.tenant_id = $1
          AND t.phone_e164 = $2
          AND t.status = 2
          AND t.sent_at >= NOW() - INTERVAL '7 days'
        ORDER BY t.sent_at DESC
        LIMIT 1
        `,
        [tenantId, phoneE164],
      );
      if (targetRows.length > 0) {
        lastTargetId = targetRows[0].id;
        kbId = targetRows[0].kb_id;
      }
      // 没命中 campaign → 用租户 default KB
      if (!kbId) {
        const settings = await this.settings.get(tenantId);
        kbId = settings.defaultKbId;
      }
      conv = await this.convRepo.save(
        this.convRepo.create({
          tenantId,
          slotId,
          phoneE164,
          stage: ConversationStage.New,
          kbId,
          lastCampaignTargetId: lastTargetId,
          openedAt: new Date(),
        }),
      );
    }
    return conv;
  }

  private isInQuietHours(start: string, end: string): boolean {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;
    if (startMin === endMin) return false;
    if (startMin < endMin) {
      // 同日段
      return nowMin >= startMin && nowMin < endMin;
    }
    // 跨午夜 (22:00 - 08:00)
    return nowMin >= startMin || nowMin < endMin;
  }

  private jidToPhone(jid: string): string | null {
    if (!jid) return null;
    const at = jid.indexOf('@');
    if (at < 0) return null;
    const head = jid.slice(0, at);
    if (!/^\d{8,15}$/.test(head)) return null;
    return head;
  }

  isLevel2HandoffKeyword(text: string): boolean {
    const lower = text.toLowerCase();
    return HANDOFF_KEYWORDS_LEVEL2.some((k) => lower.includes(k.toLowerCase()));
  }
}
