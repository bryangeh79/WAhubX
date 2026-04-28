import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import {
  ConversationStage,
  CustomerConversationEntity,
} from '../entities/customer-conversation.entity';
import { KbChunkEntity } from '../entities/kb-chunk.entity';
import { KbFaqEntity } from '../entities/kb-faq.entity';
import { KnowledgeBaseEntity } from '../entities/knowledge-base.entity';
import { AiReplyAuditEntity, AuditMode } from '../entities/ai-reply-audit.entity';
import { PlatformAiService } from './platform-ai.service';
import { TenantReplySettingsService } from './tenant-reply-settings.service';
import { SlotsService } from '../../slots/slots.service';
import { AccountSlotEntity } from '../../slots/account-slot.entity';
import { AiTextService } from '../../ai/ai-text.service';

const FAQ_MATCH_THRESHOLD = 0.55; // Jaccard 相似度
const RAG_CONF_HIGH = 0.75;
const RAG_CONF_LOW = 0.45;
const MAX_REPLY_LENGTH = 200;

@Injectable()
export class ReplyExecutorService {
  private readonly logger = new Logger(ReplyExecutorService.name);

  constructor(
    @InjectRepository(CustomerConversationEntity)
    private readonly convRepo: Repository<CustomerConversationEntity>,
    @InjectRepository(KbChunkEntity)
    private readonly chunkRepo: Repository<KbChunkEntity>,
    @InjectRepository(KbFaqEntity)
    private readonly faqRepo: Repository<KbFaqEntity>,
    @InjectRepository(KnowledgeBaseEntity)
    private readonly kbRepo: Repository<KnowledgeBaseEntity>,
    @InjectRepository(AiReplyAuditEntity)
    private readonly auditRepo: Repository<AiReplyAuditEntity>,
    @InjectRepository(AccountSlotEntity)
    private readonly slotRepo: Repository<AccountSlotEntity>,
    private readonly platformAi: PlatformAiService,
    private readonly settings: TenantReplySettingsService,
    // 2026-04-26 · R9-bis · 改走 SlotsService.sendText facade · chromium-aware
    private readonly slots: SlotsService,
    private readonly tenantAi: AiTextService,
  ) {}

  async handle(conversationId: number, mergedQuestion: string, _messageIds: string[]): Promise<void> {
    const conv = await this.convRepo.findOne({ where: { id: conversationId } });
    if (!conv) return;
    // 再次检查 stage (flush 期间可能被人工接管)
    if (
      conv.stage === ConversationStage.HumanTakeover ||
      conv.stage === ConversationStage.DoNotReply ||
      conv.stage === ConversationStage.Closed
    ) {
      this.logger.debug(`conv ${conv.id} stage=${conv.stage} · executor 跳`);
      return;
    }

    const settings = await this.settings.get(conv.tenantId);
    if (settings.mode === 'off') return;

    // 2026-04-28 · 双层 KB Fallback (产品 KB → 通用 KB → RAG → handoff)
    // primaryKbId: 对话绑定的产品 KB (或 fallback 到 default)
    // secondaryKbId: 通用 KB (default_kb_id) · 仅当 primary 不是 default 时启用
    const primaryKbId = conv.kbId ?? settings.defaultKbId;
    if (!primaryKbId) {
      this.logger.debug(`conv ${conv.id} · 无 KB · handoff`);
      await this.markHandoff(conv);
      return;
    }
    const secondaryKbId =
      settings.defaultKbId && primaryKbId !== settings.defaultKbId
        ? settings.defaultKbId
        : null;

    const primaryKb = await this.kbRepo.findOne({ where: { id: primaryKbId } });
    if (!primaryKb) {
      await this.markHandoff(conv);
      return;
    }

    // 1A · FAQ 匹配 (产品 KB)
    const faqMatch = await this.matchFaq(primaryKbId, mergedQuestion);
    if (faqMatch && faqMatch.score >= FAQ_MATCH_THRESHOLD) {
      this.logger.log(
        `conv ${conv.id} · FAQ 命中 primary kb=${primaryKbId} · score=${faqMatch.score.toFixed(2)} · faq=${faqMatch.faq.id}`,
      );
      const replyText = this.applyGuardrail(faqMatch.faq.answer, mergedQuestion, primaryKbId);
      await this.send(conv, replyText, {
        mode: 'faq',
        kbId: primaryKbId,
        matchedFaqId: faqMatch.faq.id,
        confidence: faqMatch.score,
        intent: 'faq_hit',
        handoff: false,
      });
      await this.faqRepo.increment({ id: faqMatch.faq.id }, 'hitCount', 1);
      return;
    }

    // 1B · 双层 fallback · FAQ 匹配 (通用 KB)
    if (secondaryKbId) {
      const faqMatch2 = await this.matchFaq(secondaryKbId, mergedQuestion);
      if (faqMatch2 && faqMatch2.score >= FAQ_MATCH_THRESHOLD) {
        this.logger.log(
          `conv ${conv.id} · FAQ 命中 secondary 通用 kb=${secondaryKbId} · score=${faqMatch2.score.toFixed(2)} · faq=${faqMatch2.faq.id}`,
        );
        const replyText = this.applyGuardrail(
          faqMatch2.faq.answer,
          mergedQuestion,
          secondaryKbId,
        );
        await this.send(conv, replyText, {
          mode: 'faq',
          kbId: secondaryKbId,
          matchedFaqId: faqMatch2.faq.id,
          confidence: faqMatch2.score,
          intent: 'faq_hit_fallback',
          handoff: false,
        });
        await this.faqRepo.increment({ id: faqMatch2.faq.id }, 'hitCount', 1);
        return;
      }
    }

    // 2026-04-24 · FAQ 模式: FAQ 没命中就转人工 · 不调 AI
    if (settings.mode === 'faq') {
      this.logger.debug(`conv ${conv.id} · FAQ 模式 · primary+secondary FAQ 都未命中 · handoff`);
      await this.markHandoff(conv, 'FAQ 模式 · 未命中');
      return;
    }

    // 2. (smart 模式) AI RAG · embedding 用平台 · LLM 用租户自己配的 provider
    if (!this.platformAi.isEmbedAvailable()) {
      // embedding 不可用 → handoff
      await this.markHandoff(conv, '平台 embedding 未配置');
      return;
    }

    // 对问题做 embedding
    const embedRes = await this.platformAi.embed([mergedQuestion]);
    if (!embedRes.ok || embedRes.vectors.length === 0) {
      await this.markHandoff(conv, 'embedding 失败');
      return;
    }
    const qVec = embedRes.vectors[0];

    // 向量检索 top-3 (优先产品 KB)
    const primaryCandidates = await this.chunkRepo.find({ where: { kbId: primaryKbId } });
    let scored = primaryCandidates
      .filter((c) => c.embedding && c.embedding.length === qVec.length)
      .map((c) => ({ chunk: c, score: this.cosine(qVec, c.embedding!) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    let topScore = scored[0]?.score ?? 0;
    let usedKbId = primaryKbId;
    let usedKb = primaryKb;

    // 2026-04-28 · 双层 fallback · primary RAG 信心低 · 试通用 KB
    if (topScore < RAG_CONF_HIGH && secondaryKbId) {
      const secondaryCandidates = await this.chunkRepo.find({ where: { kbId: secondaryKbId } });
      const scored2 = secondaryCandidates
        .filter((c) => c.embedding && c.embedding.length === qVec.length)
        .map((c) => ({ chunk: c, score: this.cosine(qVec, c.embedding!) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      const topScore2 = scored2[0]?.score ?? 0;
      if (topScore2 > topScore) {
        // 通用 KB 信心更高 · 切到通用
        this.logger.log(
          `conv ${conv.id} · RAG fallback to secondary kb=${secondaryKbId} · score=${topScore2.toFixed(2)} > primary ${topScore.toFixed(2)}`,
        );
        scored = scored2;
        topScore = topScore2;
        usedKbId = secondaryKbId;
        const secondKb = await this.kbRepo.findOne({ where: { id: secondaryKbId } });
        if (secondKb) usedKb = secondKb;
      }
    }

    if (topScore < RAG_CONF_LOW) {
      // 置信度太低 → 不编造, handoff
      await this.send(
        conv,
        '这个问题让我确认一下, 稍后让同事跟你联系 🙌',
        {
          mode: 'handoff',
          kbId: usedKbId,
          confidence: topScore,
          intent: 'low_confidence',
          handoff: true,
        },
      );
      await this.markHandoff(conv, 'RAG 低置信度 (primary+fallback 都低)');
      return;
    }

    // 组 prompt 调 LLM
    const context = scored.map((s) => s.chunk.text).join('\n\n---\n\n');
    const goal = usedKb.goalPrompt?.trim() || '让客户了解产品并留下联系方式';
    const blackList = (settings.blacklistKeywords ?? []).join('; ');

    const systemPrompt = `你是该公司的 WhatsApp 客服代表. 保持友善/简洁/口语化.
业务目标: ${goal}
重要规则:
- 只根据"资料"内容回答, 不编造
- 资料里有的联系方式 (电话/网址/邮箱) 必须保留原样
- 不报具体价格数字 (若客户问价 · 引导留联系方式)
- 不承诺 "100%" / "保证" / "绝对"
- 回复 ${MAX_REPLY_LENGTH} 字以内
- 不提及竞品${blackList ? `\n- 禁止话题: ${blackList}` : ''}

输出严格 JSON: {"reply": "回复文字", "intent": "curious|interested|buying|complaint|handoff", "handoff": true|false}`;

    const userPrompt = `资料:
"""
${context.slice(0, 4000)}
"""

客户说: ${mergedQuestion}`;

    // 2026-04-24 · LLM 调用改走租户自己配的 AI (成本由租户承担)
    const llmRes = await this.tenantAi.chatWithTenant({
      systemPrompt,
      userPrompt,
      maxTokens: 512,
      timeoutMs: 30_000,
    });

    if (!llmRes.ok) {
      this.logger.warn(
        `tenant LLM call failed: ${llmRes.errorCode} · ${llmRes.errorMessage}`,
      );
      // 租户 AI 没配 → 提醒去配置 + handoff
      if (llmRes.errorCode === 'NO_PROVIDER') {
        await this.markHandoff(conv, '租户未配置 AI · 请去 设置→AI 配置 填 key');
      } else {
        await this.markHandoff(conv, `LLM 失败: ${llmRes.errorCode}`);
      }
      return;
    }

    let parsed: { reply?: string; intent?: string; handoff?: boolean } = {};
    try {
      parsed = JSON.parse(llmRes.text);
    } catch {
      // 若不是 JSON · 当纯文本用
      parsed = { reply: llmRes.text, intent: 'unknown', handoff: false };
    }

    let replyText = (parsed.reply ?? '').trim();
    if (!replyText) {
      await this.markHandoff(conv, 'LLM 返回空');
      return;
    }

    // 若 RAG 置信度处于中区 · 强制附加 "建议人工确认"
    if (topScore < RAG_CONF_HIGH && topScore >= RAG_CONF_LOW) {
      if (!parsed.handoff) parsed.handoff = true;
    }

    // Guardrail 后处理
    replyText = this.applyGuardrail(replyText, mergedQuestion, usedKbId);

    await this.send(conv, replyText, {
      mode: 'ai',
      kbId: usedKbId,
      matchedChunkIds: scored.map((s) => s.chunk.id),
      confidence: topScore,
      model: llmRes.model,
      intent: parsed.intent ?? 'unknown',
      handoff: parsed.handoff ?? false,
      // 租户 AI 目前没返 token 统计 · 留 0
      costTokensIn: 0,
      costTokensOut: 0,
    });

    // 意图驱动状态机
    if (parsed.handoff) {
      await this.markHandoff(conv, `intent=${parsed.intent}`);
    } else if (parsed.intent === 'buying') {
      conv.stage = ConversationStage.HotLead;
      await this.convRepo.save(conv);
    } else if (parsed.intent === 'interested') {
      conv.stage = ConversationStage.Interested;
      await this.convRepo.save(conv);
    }
  }

  // ── FAQ 匹配 · Jaccard (V1) ────────────────

  private async matchFaq(
    kbId: number,
    question: string,
  ): Promise<{ faq: KbFaqEntity; score: number } | null> {
    const faqs = await this.faqRepo.find({
      where: { kbId, status: 'enabled' as const },
    });
    if (faqs.length === 0) return null;

    const qTokens = this.tokenize(question);
    if (qTokens.size === 0) return null;

    let best: { faq: KbFaqEntity; score: number } | null = null;
    for (const f of faqs) {
      const fTokens = this.tokenize(f.question);
      const score = this.jaccard(qTokens, fTokens);
      if (!best || score > best.score) {
        best = { faq: f, score };
      }
    }
    return best;
  }

  private tokenize(s: string): Set<string> {
    // 简单切词: 中文按字 · 英文按词
    const tokens = new Set<string>();
    const normalized = s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
    // 英文词
    for (const m of normalized.matchAll(/[a-z]{2,}|\d+/g)) {
      tokens.add(m[0]);
    }
    // 中文字 (单字也算 token · 粗但够 V1)
    for (const m of normalized.matchAll(/[\p{Script=Han}]/gu)) {
      tokens.add(m[0]);
    }
    return tokens;
  }

  private jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    const union = a.size + b.size - inter;
    return union > 0 ? inter / union : 0;
  }

  // ── 向量余弦 ───────────────────────────────

  private cosine(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  // ── Guardrail ──────────────────────────────

  private applyGuardrail(text: string, _originalQuestion: string, _kbId: number): string {
    let out = text;
    // 长度
    if (out.length > MAX_REPLY_LENGTH) out = out.slice(0, MAX_REPLY_LENGTH) + '…';
    // 过度承诺
    out = out.replace(/100%|百分百|绝对|保证你|一定|绝不/g, '');
    // 价格数字 (RM 100 / $50 / 100 美元) → 引导
    out = out.replace(/(RM|MYR|\$|USD|¥|CNY|RMB)\s?\d+[\d,]*/gi, '具体价格请联系顾问');
    // 清连续空格
    out = out.replace(/\s{2,}/g, ' ').trim();
    return out;
  }

  // ── 发送 + 审计 ────────────────────────────

  private async send(
    conv: CustomerConversationEntity,
    replyText: string,
    meta: {
      mode: AuditMode;
      kbId?: number | null;
      matchedFaqId?: number | null;
      matchedChunkIds?: number[];
      confidence?: number | null;
      model?: string | null;
      intent?: string;
      handoff: boolean;
      costTokensIn?: number;
      costTokensOut?: number;
    },
  ): Promise<void> {
    const settings = await this.settings.get(conv.tenantId);
    let sentMessageId: string | null = null;

    // 2026-04-24 · FAQ / smart 都真发 · off 模式由上游过滤 (这里走不到)
    if (settings.mode === 'faq' || settings.mode === 'smart') {
      // 真发
      try {
        const slot = await this.slotRepo.findOne({ where: { id: conv.slotId } });
        if (!slot) throw new Error('slot 不存在');
        const jid = `${conv.phoneE164}@s.whatsapp.net`;
        // 2026-04-26 · R9-bis · 走 SlotsService facade · chromium-aware
        const sendRes = await this.slots.sendText(conv.slotId, jid, replyText);
        sentMessageId = sendRes.waMessageId;
        // 更新 conversation 计数
        conv.lastAiReplyAt = new Date();
        conv.aiReplyCount24h = (conv.aiReplyCount24h ?? 0) + 1;
        conv.aiReplyCountTotal = (conv.aiReplyCountTotal ?? 0) + 1;
        await this.convRepo.save(conv);
      } catch (err) {
        this.logger.warn(`sendText failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // 审计
    await this.auditRepo.save(
      this.auditRepo.create({
        tenantId: conv.tenantId,
        conversationId: conv.id,
        replyText,
        mode: meta.mode,
        kbId: meta.kbId ?? null,
        matchedFaqId: meta.matchedFaqId ?? null,
        matchedChunkIds: meta.matchedChunkIds ?? null,
        confidence: meta.confidence != null ? String(meta.confidence.toFixed(3)) : null,
        model: meta.model ?? null,
        intent: meta.intent ?? null,
        handoffTriggered: meta.handoff,
        sentMessageId,
        draft: false,
        costTokensIn: meta.costTokensIn ?? 0,
        costTokensOut: meta.costTokensOut ?? 0,
      }),
    );
  }

  private async markHandoff(conv: CustomerConversationEntity, reason?: string): Promise<void> {
    conv.stage = ConversationStage.HandoffRequired;
    await this.convRepo.save(conv);
    // 写审计
    await this.auditRepo.save(
      this.auditRepo.create({
        tenantId: conv.tenantId,
        conversationId: conv.id,
        mode: 'handoff',
        handoffTriggered: true,
        intent: reason ?? 'handoff',
      }),
    );
    this.logger.log(`conv ${conv.id} · handoff (${reason ?? 'unknown'})`);
  }

  // 供 handoff UI 取 Pending 列表
  async listPendingHandoffs(tenantId: number, limit = 50): Promise<CustomerConversationEntity[]> {
    return this.convRepo.find({
      where: { tenantId, stage: ConversationStage.HandoffRequired },
      order: { lastInboundAt: 'DESC' },
      take: limit,
    });
  }

  async listByStages(
    tenantId: number,
    stages: ConversationStage[],
    limit = 100,
  ): Promise<CustomerConversationEntity[]> {
    return this.convRepo.find({
      where: { tenantId, stage: In(stages) },
      order: { lastInboundAt: 'DESC' },
      take: limit,
    });
  }

  async markConversationStage(
    tenantId: number,
    convId: number,
    stage: ConversationStage,
  ): Promise<CustomerConversationEntity> {
    const row = await this.convRepo.findOne({ where: { id: convId, tenantId } });
    if (!row) throw new Error('conv 不存在');
    row.stage = stage;
    if (stage === ConversationStage.HumanTakeover) {
      // 重置 AI 计数 (给后续人工回复空间)
    }
    return this.convRepo.save(row);
  }
}
