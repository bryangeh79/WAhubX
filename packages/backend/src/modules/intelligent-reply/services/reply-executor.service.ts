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
    // 再次检查 stage (flush 期间可能被人工接管 / 已 handoff)
    // 2026-04-28 · HandoffRequired 也跳 · 已转人工不再 AI 回复
    if (
      conv.stage === ConversationStage.HumanTakeover ||
      conv.stage === ConversationStage.DoNotReply ||
      conv.stage === ConversationStage.Closed ||
      conv.stage === ConversationStage.HandoffRequired
    ) {
      this.logger.debug(`conv ${conv.id} stage=${conv.stage} · executor 跳`);
      return;
    }

    const settings = await this.settings.get(conv.tenantId);
    if (settings.mode === 'off') return;

    // 2026-04-28 · 双层 KB Fallback (产品 KB list → 通用 KB → RAG → handoff)
    //   bug 修: 老逻辑 primaryKbId = conv.kbId ?? defaultKbId · 当 conv 没绑产品 KB 时
    //          primary === default → secondary 自动 null → 产品 KB 永远查不到
    //          症状: 客户问 fahubx · 系统只搜通用 KB · 找不到 → "资料不全"
    //   修: conv 没绑产品 KB (kbId 空 OR = default) 时, primary 扩展为 tenant 所有产品 KB
    //       逐个试 FAQ → 取最优; RAG 也跨多 KB 检索 chunks
    const defaultKbId = settings.defaultKbId;
    let primaryKbIds: number[] = [];
    // 2026-04-28 · 产品名 keyword pre-filter
    //   bug 复现: 客户问 "fahubx" · RAG 跨 [10,11,12] 余弦把 WAhubX (kb 11) 排在 FAhubX (kb 10) 之上
    //   修: 客户消息含产品名 (kb.name 子串) 时 · 强制 primary 限定到那个 KB
    //       优先做精确产品名匹配 · 模糊用 lowercase + alphanumeric 化
    const allProductKbs = await this.kbRepo.find({
      where: { tenantId: conv.tenantId, isDefault: false, status: 1 },
    });
    const normalizeForKbName = (s: string): string =>
      s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const qNorm = normalizeForKbName(mergedQuestion);
    const hitKbsByName = allProductKbs.filter((k) => {
      const kbNorm = normalizeForKbName(k.name);
      return kbNorm.length >= 3 && qNorm.includes(kbNorm);
    });
    // 2026-04-28 · isKbExplicitlyTargeted · 客户消息含产品名时设 true
    //   后续低 RAG 分时不走 clarify · 仍喂该 KB chunks 给 LLM 答
    //   原因: KB 内文可能用旧产品名 (e.g. "Facebook Auto Bot") · 客户用新名问 ("fahubx") · cosine 低
    //   既然 keyword 已锁定 KB · LLM 直接答比 clarify 体验好
    const isKbExplicitlyTargeted = hitKbsByName.length > 0;
    if (isKbExplicitlyTargeted) {
      primaryKbIds = hitKbsByName.map((k) => k.id);
      this.logger.log(
        `conv ${conv.id} · 产品名 keyword pre-filter 命中 · 限定 primary 到 [${hitKbsByName.map((k) => `${k.id}:${k.name}`).join(', ')}]`,
      );
    } else if (conv.kbId && conv.kbId !== defaultKbId) {
      // conv 已归因到具体产品 KB (campaign 路径)
      primaryKbIds = [conv.kbId];
    } else {
      // conv 没绑或绑到 default · 把 tenant 所有产品 KB 都纳入 primary
      primaryKbIds = allProductKbs.map((k) => k.id);
    }
    // secondary 始终是通用 KB · 排重避免重复搜
    const secondaryKbId =
      defaultKbId && !primaryKbIds.includes(defaultKbId) ? defaultKbId : null;

    if (primaryKbIds.length === 0 && !secondaryKbId) {
      this.logger.debug(`conv ${conv.id} · tenant 没任何 KB · handoff`);
      await this.markHandoff(conv, '租户无可用 KB');
      return;
    }

    // 1A · FAQ 匹配 (跨所有 primary 产品 KB · 取最优)
    let bestPrimary: { kbId: number; faq: KbFaqEntity; score: number } | null = null;
    for (const pKbId of primaryKbIds) {
      const m = await this.matchFaq(pKbId, mergedQuestion);
      if (m && (!bestPrimary || m.score > bestPrimary.score)) {
        bestPrimary = { kbId: pKbId, faq: m.faq, score: m.score };
      }
    }
    if (bestPrimary && bestPrimary.score >= FAQ_MATCH_THRESHOLD) {
      this.logger.log(
        `conv ${conv.id} · FAQ 命中 primary kb=${bestPrimary.kbId} (跨 ${primaryKbIds.length} 个产品 KB) · score=${bestPrimary.score.toFixed(2)} · faq=${bestPrimary.faq.id}`,
      );
      const replyText = this.applyGuardrail(bestPrimary.faq.answer, mergedQuestion, bestPrimary.kbId);
      await this.send(conv, replyText, {
        mode: 'faq',
        kbId: bestPrimary.kbId,
        matchedFaqId: bestPrimary.faq.id,
        confidence: bestPrimary.score,
        intent: 'faq_hit',
        handoff: false,
      });
      await this.faqRepo.increment({ id: bestPrimary.faq.id }, 'hitCount', 1);
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

    // 2026-04-28 · 跨多产品 KB 向量检索
    //   conv 没绑产品 KB 时, primaryKbIds = tenant 所有产品 KB · 跨 KB 取 top-3
    //   chunks 携带 kbId · 命中后用此 kbId 拿对应 KB 的 goalPrompt
    let scored: Array<{ chunk: KbChunkEntity; score: number; kbId: number }> = [];
    if (primaryKbIds.length > 0) {
      const primaryCandidates = await this.chunkRepo.find({
        where: { kbId: In(primaryKbIds) },
      });
      scored = primaryCandidates
        .filter((c) => c.embedding && c.embedding.length === qVec.length)
        .map((c) => ({ chunk: c, score: this.cosine(qVec, c.embedding!), kbId: c.kbId }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
    }

    let topScore = scored[0]?.score ?? 0;
    let usedKbId = scored[0]?.kbId ?? (primaryKbIds[0] ?? secondaryKbId ?? 0);
    let usedKb = await this.kbRepo.findOne({ where: { id: usedKbId } });

    // 2026-04-28 · 双层 fallback · primary RAG 信心低 · 试通用 KB
    if (topScore < RAG_CONF_HIGH && secondaryKbId) {
      const secondaryCandidates = await this.chunkRepo.find({ where: { kbId: secondaryKbId } });
      const scored2 = secondaryCandidates
        .filter((c) => c.embedding && c.embedding.length === qVec.length)
        .map((c) => ({ chunk: c, score: this.cosine(qVec, c.embedding!), kbId: c.kbId }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      const topScore2 = scored2[0]?.score ?? 0;
      if (topScore2 > topScore) {
        this.logger.log(
          `conv ${conv.id} · RAG fallback to secondary kb=${secondaryKbId} · score=${topScore2.toFixed(2)} > primary ${topScore.toFixed(2)}`,
        );
        scored = scored2;
        topScore = topScore2;
        usedKbId = secondaryKbId;
        usedKb = await this.kbRepo.findOne({ where: { id: secondaryKbId } });
      }
    }
    if (!usedKb) {
      // 全 KB 找不到 chunks · 用 primary 第一个 KB 的 metadata 兜底
      usedKb = await this.kbRepo.findOne({ where: { id: primaryKbIds[0] ?? secondaryKbId ?? 0 } });
    }

    if (topScore < RAG_CONF_LOW && !isKbExplicitlyTargeted) {
      // 2026-04-28 · 低置信度 · 不再"懒散转人工" · 让 AI 主动澄清引导
      //   bug: 老逻辑只看 score · 即使客户明确说了产品名 (KB pre-filter 命中) · 仍走 clarify
      //        实测: 客户问 "fahubx" · KB 锁到 FAhubX · 但 chunks 内文是 "Facebook Auto Bot" → cosine 低 → clarify
      //   修: isKbExplicitlyTargeted=true 时绕过这条 · 继续往下走 RAG 答路径
      //       LLM 用该 KB top chunks · system prompt 提示别名 · 自行组织
      const clarifySystemPrompt = `你是该公司 WhatsApp 客服 · 友善亲切口语化 · 80 字以内`;
      const clarifyUserPrompt = `客户问: "${mergedQuestion}"

我这边资料不全 · 不能直接答. 请你:
1. 礼貌致歉 (一句话)
2. 引导客户说更多 (例如: 想了解产品具体哪方面 · 您是哪家公司 · 已有订单号吗 · 等)
3. 提示如需立即联系真人请回复"人工"

直接输出回复文本 · 不要 JSON · 不超 80 字.`;

      let clarifyText =
        '您好! 关于这个问题我需要更多信息才能帮到您. 请问能再具体说说您想了解什么吗? 也可以回复"人工"联系真人客服.';
      try {
        const clarifyRes = await this.tenantAi.chatWithTenant({
          systemPrompt: clarifySystemPrompt,
          userPrompt: clarifyUserPrompt,
          maxTokens: 200,
          timeoutMs: 20_000,
        });
        if (clarifyRes.ok && clarifyRes.text.trim()) {
          clarifyText = this.applyGuardrail(clarifyRes.text.trim(), mergedQuestion, usedKbId);
        }
      } catch (err) {
        this.logger.warn(`clarify AI failed: ${err instanceof Error ? err.message : err}`);
        // 用兜底 clarifyText (默认值)
      }
      await this.send(conv, clarifyText, {
        mode: 'ai',
        kbId: usedKbId,
        confidence: topScore,
        intent: 'clarify_low_confidence',
        handoff: false,
      });
      // 不调 markHandoff · conv stage 保持 'new' · 下条消息能继续答
      return;
    }

    // 组 prompt 调 LLM
    const context = scored.map((s) => s.chunk.text).join('\n\n---\n\n');
    const goal = usedKb?.goalPrompt?.trim() || '让客户了解产品并留下联系方式';
    const blackList = (settings.blacklistKeywords ?? []).join('; ');

    // 2026-04-28 · 当前命中 KB 的 name (产品别名提示用)
    let targetedKbName = usedKb?.name ?? '';
    if (!targetedKbName && primaryKbIds.length > 0) {
      const firstKb = await this.kbRepo.findOne({ where: { id: primaryKbIds[0] } });
      targetedKbName = firstKb?.name ?? '';
    }
    const systemPrompt = `你是该公司的 WhatsApp 客服代表. 保持友善/简洁/口语化.
业务目标: ${goal}
重要规则:
- 只根据"资料"内容回答, 不编造
- 资料里有的联系方式 (电话/网址/邮箱) 必须保留原样
- 不报具体价格数字 (若客户问价 · 引导留联系方式)
- 不承诺 "100%" / "保证" / "绝对"
- 回复 ${MAX_REPLY_LENGTH} 字以内
- 不提及竞品${blackList ? `\n- 禁止话题: ${blackList}` : ''}
${
  targetedKbName
    ? `- 当前产品 = "${targetedKbName}" · 资料里可能用旧名/英文名/简称 (例如 "${targetedKbName}" 在资料中可能写作不同名字) · 答客户时统一用客户的称呼 "${targetedKbName}", 内容以资料为准`
    : ''
}

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

    // 2026-04-28 · 中区 (0.45-0.75) 不再强制 markHandoff
    //   bug 复现: 客户问 fahubx · RAG 中区命中 WAhubX KB · AI 答 WAhubX 介绍 + 强制 handoff
    //            客户纠正"不是 wahubx 是 FAhubx" · 进 handoff_required · 后续问 M33 也 silent ack
    //            实际上 AI 已经答了客户该有信心继续追问 · 不该一口气结束对话
    //   修: 中区只 log 警告 · 不 force handoff · 让 LLM 看 intent 自己判 (intent='handoff' 才 mark)
    if (topScore < RAG_CONF_HIGH && topScore >= RAG_CONF_LOW) {
      this.logger.log(
        `conv ${conv.id} · RAG 中区命中 score=${topScore.toFixed(2)} · LLM intent=${parsed.intent} handoff=${parsed.handoff} · 不 force handoff (让客户能继续问)`,
      );
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

    // 2026-04-28 · Codex 执行单 D · 多语言 FAQ 优先
    //   bug: 客户问 "Hi" · 跟英文 + 中文 FAQ 都低 jaccard · 排序不稳
    //   fix: 同语言 FAQ score × 1.20 boost · 不同语言 score × 0.80 降权
    //        "Hi" → en boost · 优先命中 "Hi! Thanks for reaching out..."
    //        "你好" → zh boost · 不会跑去英文 FAQ
    const qLang = this.detectLang(question);

    let best: { faq: KbFaqEntity; score: number } | null = null;
    for (const f of faqs) {
      const fTokens = this.tokenize(f.question);
      let score = this.jaccard(qTokens, fTokens);
      // 语言加权 · 同语言 +20% · 异语言 -20% · mixed/未知 不动
      if (qLang !== 'mixed' && qLang !== 'unknown') {
        const fLangs = this.faqLangs(f);
        if (fLangs.has(qLang)) {
          score *= 1.2;
        } else if (fLangs.size > 0 && !fLangs.has('mixed')) {
          score *= 0.8;
        }
      }
      // 限上限 1.0 (保留 threshold 语义)
      if (score > 1) score = 1;
      if (!best || score > best.score) {
        best = { faq: f, score };
      }
    }
    return best;
  }

  // 2026-04-28 · Codex D · 语言检测 (粗规则 · 跑 hot path · 不调外部)
  private detectLang(s: string): 'zh' | 'en' | 'mixed' | 'unknown' {
    const hasHan = /\p{Script=Han}/u.test(s);
    const hasLatin = /[a-zA-Z]/.test(s);
    if (hasHan && hasLatin) return 'mixed';
    if (hasHan) return 'zh';
    if (hasLatin) return 'en';
    return 'unknown';
  }

  // 2026-04-28 · Codex D · 从 FAQ tags/question 推语言集
  private faqLangs(f: KbFaqEntity): Set<'zh' | 'en' | 'mixed'> {
    const out = new Set<'zh' | 'en' | 'mixed'>();
    const tags = (f.tags ?? []).map((t) => t.toLowerCase());
    if (tags.includes('zh')) out.add('zh');
    if (tags.includes('en')) out.add('en');
    if (out.size === 0) {
      // 没 tag · 看 question 文本
      const qLang = this.detectLang(f.question);
      if (qLang === 'zh') out.add('zh');
      else if (qLang === 'en') out.add('en');
      else if (qLang === 'mixed') out.add('mixed');
    } else if (out.size === 2) {
      out.add('mixed');
    }
    return out;
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

  // ════════════════════════════════════════════════════════════════
  // 2026-04-28 · Codex 执行单 E/F/G · 系统通知 + 真 24h count + handoff 自救
  // ════════════════════════════════════════════════════════════════

  /**
   * 发系统通知 (一次性) · 不计入 ai_reply_audit 的"日上限计数"
   *   intent 字段标 'system_notice_*' · F 计数器查 24h 时 EXCLUDE 这类 intent
   *
   * 用途:
   *   - E: 单 conv 30 条上限通知
   *   - F: tenant daily limit 通知
   *   - G: handoff 后客户再发 · 一次性提醒
   *   - G: 5min 超时自救
   */
  async sendSystemNotice(
    conv: CustomerConversationEntity,
    text: string,
    intent: string,
  ): Promise<void> {
    let sentMessageId: string | null = null;
    try {
      const slot = await this.slotRepo.findOne({ where: { id: conv.slotId } });
      if (!slot) throw new Error('slot 不存在');
      const jid = `${conv.phoneE164}@s.whatsapp.net`;
      const sendRes = await this.slots.sendText(conv.slotId, jid, text);
      sentMessageId = sendRes.waMessageId;
    } catch (err) {
      this.logger.warn(
        `sendSystemNotice failed (conv=${conv.id} intent=${intent}): ${err instanceof Error ? err.message : err}`,
      );
    }
    // 审计 · 但不计入 daily limit (通过 intent='system_notice_*' 区分)
    await this.auditRepo.save(
      this.auditRepo.create({
        tenantId: conv.tenantId,
        conversationId: conv.id,
        replyText: text,
        mode: 'handoff',
        kbId: null,
        intent,
        handoffTriggered: false,
        sentMessageId,
        draft: false,
        costTokensIn: 0,
        costTokensOut: 0,
      }),
    );
    this.logger.log(`conv ${conv.id} · system notice sent · intent=${intent}`);
  }

  /**
   * F · 真 24h tenant 级 ai_reply 数 (EXCLUDE 系统通知)
   *   只数 intent 不是 system_notice_* 的
   */
  async getTenantAiReplyCount24h(tenantId: number): Promise<number> {
    const row = await this.auditRepo
      .createQueryBuilder('a')
      .where('a.tenant_id = :t', { t: tenantId })
      .andWhere('a.created_at >= NOW() - INTERVAL \'24 hours\'')
      .andWhere('(a.intent IS NULL OR a.intent NOT LIKE :sys)', { sys: 'system_notice_%' })
      .andWhere('a.sent_message_id IS NOT NULL') // 真发出去的才数
      .getCount();
    return row;
  }

  /**
   * G · 5min 自救扫描 · 找超 5min 没人工跟的 handoff_required conv · 补一次通知
   *   定时器由 onModuleInit 启 (每分钟跑)
   */
  async runHandoffTimeoutSweep(): Promise<void> {
    try {
      // 找 handoff_required 且 lastInboundAt 超 5min · 且最近 5min 没系统通知/真人回复
      const candidates = await this.convRepo
        .createQueryBuilder('c')
        .where('c.stage = :s', { s: ConversationStage.HandoffRequired })
        .andWhere('c.last_inbound_at >= NOW() - INTERVAL \'24 hours\'') // 只看 24h 内还活的
        .andWhere('c.last_inbound_at <= NOW() - INTERVAL \'5 minutes\'')
        .getMany();
      for (const conv of candidates) {
        // 看最近 5min 有没有发过 timeout_followup
        const recent = await this.auditRepo
          .createQueryBuilder('a')
          .where('a.conversation_id = :c', { c: conv.id })
          .andWhere('a.intent = :i', { i: 'system_notice_handoff_timeout' })
          .andWhere('a.created_at >= NOW() - INTERVAL \'30 minutes\'')
          .getCount();
        if (recent > 0) continue;
        await this.sendSystemNotice(
          conv,
          '我们已记录您的问题, 真人客服会在工作时间内尽快回复您, 请稍候.',
          'system_notice_handoff_timeout',
        );
      }
    } catch (err) {
      this.logger.warn(
        `runHandoffTimeoutSweep failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
