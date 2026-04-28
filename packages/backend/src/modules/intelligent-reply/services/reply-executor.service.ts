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

    // 2026-04-29 · 任务 4 · 多产品选择菜单
    //   场景: tenant 有多个产品 KB · conv 没绑产品 KB · 客户没明说哪个产品
    //   行为:
    //     a) 如果上一条 reply 是 product_menu_shown · 客户回复"1"/"2"/"产品名" → 解析 + 绑 conv.kbId
    //     b) 否则若条件满足 → 发菜单
    //   依据:
    //     - allProductKbs 数 >= 2
    //     - conv.kbId == null 或 == default
    //     - mergedQuestion 不含产品名 (走 normalizeForKbName 检测)
    //     - 客户消息 不像问候/转人工 (这些走通用 KB FAQ)
    const allProductKbsForMenu = await this.kbRepo.find({
      where: { tenantId: conv.tenantId, isDefault: false, status: 1 },
    });
    // 2026-04-29 · SaaS 边界诊断 log · 让运维一眼看到当前 tenant 真实 KB pool
    //   (确认 KB 列表 100% 从 DB 动态读取 · 不是 hardcoded WAhubX/FAhubX/M33)
    this.logger.debug?.(
      `conv ${conv.id} (tenant=${conv.tenantId}) · KB pool · default=${settings.defaultKbId ?? 'none'} · products=[${allProductKbsForMenu.map((k) => `${k.id}:${k.name}`).join(', ')}]`,
    );
    const defaultKbIdEarly = settings.defaultKbId;
    const isUnboundOrDefault = !conv.kbId || conv.kbId === defaultKbIdEarly;

    // 2026-04-29 · SaaS 测试 T7a 修 · 多产品菜单优先级降低
    //   bug: 客户问 "你吃饭了吗" / "怎么联系" 等闲聊/通用问题 · 多产品 tenant 直接发菜单
    //        正确: 通用 FAQ 先试一次 · 命中就答 (问候/闲聊/客气话/转人工等都该走通用 FAQ)
    //   规则: 触发菜单前先扫一遍通用 KB FAQ · 命中 score >= FAQ_THRESHOLD 直接答 · 不发菜单
    //   注: 这只挡 secondary KB FAQ · 产品 KB FAQ 仍走主流程 (KB pre-filter 优先)
    let earlyCommonFaqMatch: { faq: KbFaqEntity; score: number; matchedVariant?: string } | null = null;
    if (allProductKbsForMenu.length >= 2 && isUnboundOrDefault && defaultKbIdEarly) {
      earlyCommonFaqMatch = await this.matchFaq(defaultKbIdEarly, mergedQuestion);
      if (earlyCommonFaqMatch && earlyCommonFaqMatch.score >= FAQ_MATCH_THRESHOLD) {
        this.logger.log(
          `conv ${conv.id} · 早期通用 FAQ 命中 kb=${defaultKbIdEarly} · score=${earlyCommonFaqMatch.score.toFixed(2)} · 跳过菜单 · 直接答 (问候/闲聊路径)`,
        );
        const faqMeta = ReplyExecutorService.extractFaqMeta(earlyCommonFaqMatch.faq.tags);
        const replyText = this.applyGuardrail(
          earlyCommonFaqMatch.faq.answer,
          mergedQuestion,
          defaultKbIdEarly,
        );
        await this.send(conv, replyText, {
          mode: 'faq',
          kbId: defaultKbIdEarly,
          matchedFaqId: earlyCommonFaqMatch.faq.id,
          confidence: earlyCommonFaqMatch.score,
          intent: faqMeta.intent ?? 'faq_hit_common_early',
          handoff: faqMeta.handoffAction === 'always',
          metadata: {
            matched_variant: earlyCommonFaqMatch.matchedVariant ?? null,
            faq_intent: faqMeta.intent,
            faq_handoff_action: faqMeta.handoffAction,
            mode_resolved: 'common_kb_faq_early',
            early_match_skip_menu: true,
          },
        });
        await this.faqRepo.increment({ id: earlyCommonFaqMatch.faq.id }, 'hitCount', 1);
        if (faqMeta.handoffAction === 'always') {
          await this.markHandoff(conv, `faq handoff:always intent=${faqMeta.intent}`);
        }
        return;
      }
    }

    if (allProductKbsForMenu.length >= 2 && isUnboundOrDefault) {
      // (a) 看上一条 audit 是不是 product_menu_shown · 是的话尝试解析客户回复
      const lastNotice = await this.auditRepo
        .createQueryBuilder('a')
        .where('a.conversation_id = :c', { c: conv.id })
        .andWhere('a.intent = :i', { i: 'product_menu_shown' })
        .andWhere('a.created_at >= NOW() - INTERVAL \'5 minutes\'')
        .orderBy('a.id', 'DESC')
        .getOne();
      if (lastNotice) {
        const picked = this.parseProductMenuReply(mergedQuestion, allProductKbsForMenu);
        if (picked) {
          this.logger.log(
            `conv ${conv.id} · 产品菜单回复命中 · 绑 kb=${picked.id} (${picked.name})`,
          );
          conv.kbId = picked.id;
          await this.convRepo.save(conv);
          const ack = `好的, 您选了 ${picked.name} 😊 请问您想了解功能、价格还是开通流程? 也可以直接说您的需求`;
          await this.send(conv, ack, {
            mode: 'faq',
            kbId: picked.id,
            confidence: 1.0,
            intent: 'product_menu_picked',
            handoff: false,
            metadata: { kb_bound_now: true, kb_switched: false, picked_kb_id: picked.id },
          });
          return;
        }
        // 没 parse 出来 · 不发第二次菜单 · 继续走主流程 (FAQ/RAG 兜底)
      }
      // (b) 主动发菜单条件:
      //   - 客户消息没产品名
      //   - 客户消息不像问候 / 转人工 / 价格反问 (这些走通用 FAQ 答更自然)
      //   - 上一条 reply 不是菜单 (避免连发 2 次菜单)
      const qNormForMenu = mergedQuestion.toLowerCase().replace(/[^a-z0-9]/g, '');
      const containsProductName = allProductKbsForMenu.some((k) => {
        const n = k.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        return n.length >= 3 && qNormForMenu.includes(n);
      });
      const looksLikeGreeting = this.isGreetingOrSimple(mergedQuestion);
      const shouldShowMenu =
        !containsProductName && !looksLikeGreeting && !lastNotice;
      if (shouldShowMenu) {
        const tenantName = await this.getTenantDisplayName(conv.tenantId);
        const menuLines = allProductKbsForMenu
          .map((k, i) => `${i + 1}. ${k.name}${k.description ? ' - ' + k.description.slice(0, 30) : ''}`)
          .join('\n');
        const menuText = `您好, 我是 ${tenantName} 的智能客服 😊
请问您想咨询哪一个产品?

${menuLines}

直接回复编号或产品名称即可`;
        await this.send(conv, menuText, {
          mode: 'faq',
          kbId: defaultKbIdEarly ?? null,
          confidence: 1.0,
          intent: 'product_menu_shown',
          handoff: false,
          metadata: {
            product_menu_shown: true,
            available_kb_ids: allProductKbsForMenu.map((k) => k.id),
          },
        });
        return;
      }
    }

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
    // 2026-04-29 · SaaS 测试 T3 修 · KB pre-filter 中文产品名失效
    //   bug: 老 normalize 只保留 a-z0-9 · 中文产品名 ("祛痘护理配套") normalize 后 = ""
    //        中文租户 KB pre-filter 永远不命中 · 美容/课程/地产 全失效
    //   修:
    //     a) 保留中文字符 (替原 a-z0-9 limit) · 跟 parseProductMenuReply 一致
    //     b) 子串包含逻辑: KB 名所有 ≥2 字符的子串中, 任一在 query 里 → 命中
    //        客户问 "祛痘" · KB "祛痘护理配套" 子串含 "祛痘" → ✓
    //        客户问 "想了解 fahubx" · KB "FAhubX" normalize="fahubx" 整体出现 → ✓
    //        客户问 "塑形" · KB "身体塑形课程" 子串含 "塑形" → ✓
    //   安全:
    //     - 子串至少 2 字 (防单字误命中)
    //     - 多 KB 命中合并为 primaryKbIds (跨 KB 检索)
    const normalizeForKbName = (s: string): string =>
      s.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '');
    const qNorm = normalizeForKbName(mergedQuestion);
    const kbNameMatchesQuery = (kbNorm: string, qN: string): boolean => {
      if (kbNorm.length < 2 || qN.length < 2) return false;
      // 整词 includes (英文长名快路径)
      if (qN.includes(kbNorm) || kbNorm.includes(qN)) return true;
      // 子串扫描 · KB 名长度 N → 滑窗 2..N · 任一子串在 query 里 → 命中
      const maxLen = Math.min(kbNorm.length, 8);
      for (let len = maxLen; len >= 2; len--) {
        for (let i = 0; i + len <= kbNorm.length; i++) {
          const sub = kbNorm.substring(i, i + len);
          if (qN.includes(sub)) return true;
        }
      }
      return false;
    };
    const hitKbsByName = allProductKbs.filter((k) => {
      const kbNorm = normalizeForKbName(k.name);
      return kbNameMatchesQuery(kbNorm, qNorm);
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
    let bestPrimary: {
      kbId: number;
      faq: KbFaqEntity;
      score: number;
      matchedVariant?: string;
    } | null = null;
    for (const pKbId of primaryKbIds) {
      const m = await this.matchFaq(pKbId, mergedQuestion);
      if (m && (!bestPrimary || m.score > bestPrimary.score)) {
        bestPrimary = {
          kbId: pKbId,
          faq: m.faq,
          score: m.score,
          matchedVariant: m.matchedVariant,
        };
      }
    }
    if (bestPrimary && bestPrimary.score >= FAQ_MATCH_THRESHOLD) {
      this.logger.log(
        `conv ${conv.id} · FAQ 命中 primary kb=${bestPrimary.kbId} (跨 ${primaryKbIds.length} 个产品 KB) · score=${bestPrimary.score.toFixed(2)} · faq=${bestPrimary.faq.id}${bestPrimary.matchedVariant ? ` · variant="${bestPrimary.matchedVariant.slice(0, 30)}"` : ''}`,
      );
      const replyText = this.applyGuardrail(bestPrimary.faq.answer, mergedQuestion, bestPrimary.kbId);
      // 2026-04-29 · 任务 9 · 写 audit metadata · 含 matched_variant + faq tags 抽出 intent
      const faqMeta = ReplyExecutorService.extractFaqMeta(bestPrimary.faq.tags);
      await this.send(conv, replyText, {
        mode: 'faq',
        kbId: bestPrimary.kbId,
        matchedFaqId: bestPrimary.faq.id,
        confidence: bestPrimary.score,
        intent: faqMeta.intent ?? 'faq_hit',
        handoff: faqMeta.handoffAction === 'always',
        metadata: {
          matched_variant: bestPrimary.matchedVariant ?? null,
          faq_intent: faqMeta.intent,
          faq_handoff_action: faqMeta.handoffAction,
          faq_risk_level: faqMeta.riskLevel,
          mode_resolved: 'primary_kb_faq',
        },
      });
      await this.faqRepo.increment({ id: bestPrimary.faq.id }, 'hitCount', 1);
      // 任务 8 · faq tag handoff_action='always' → 直接 mark handoff
      if (faqMeta.handoffAction === 'always') {
        await this.markHandoff(conv, `faq handoff:always intent=${faqMeta.intent}`);
      }
      return;
    }

    // 1B · 双层 fallback · FAQ 匹配 (通用 KB)
    if (secondaryKbId) {
      const faqMatch2 = await this.matchFaq(secondaryKbId, mergedQuestion);
      if (faqMatch2 && faqMatch2.score >= FAQ_MATCH_THRESHOLD) {
        this.logger.log(
          `conv ${conv.id} · FAQ 命中 secondary 通用 kb=${secondaryKbId} · score=${faqMatch2.score.toFixed(2)} · faq=${faqMatch2.faq.id}${faqMatch2.matchedVariant ? ` · variant="${faqMatch2.matchedVariant.slice(0, 30)}"` : ''}`,
        );
        const replyText = this.applyGuardrail(
          faqMatch2.faq.answer,
          mergedQuestion,
          secondaryKbId,
        );
        const faqMeta = ReplyExecutorService.extractFaqMeta(faqMatch2.faq.tags);
        await this.send(conv, replyText, {
          mode: 'faq',
          kbId: secondaryKbId,
          matchedFaqId: faqMatch2.faq.id,
          confidence: faqMatch2.score,
          intent: faqMeta.intent ?? 'faq_hit_fallback',
          handoff: faqMeta.handoffAction === 'always',
          metadata: {
            matched_variant: faqMatch2.matchedVariant ?? null,
            faq_intent: faqMeta.intent,
            faq_handoff_action: faqMeta.handoffAction,
            faq_risk_level: faqMeta.riskLevel,
            mode_resolved: 'secondary_common_kb_faq',
          },
        });
        await this.faqRepo.increment({ id: faqMatch2.faq.id }, 'hitCount', 1);
        if (faqMeta.handoffAction === 'always') {
          await this.markHandoff(conv, `faq handoff:always intent=${faqMeta.intent}`);
        }
        return;
      }
    }

    // 2026-04-24 · FAQ 模式: FAQ 没命中就转人工 · 不调 AI
    // 2026-04-29 · 任务 5 · FAQ-only 兜底: 不直接 markHandoff · 发默认菜单 (产品/价格/开通流程/转人工)
    if (settings.mode === 'faq') {
      this.logger.debug(`conv ${conv.id} · FAQ 模式 · primary+secondary FAQ 都未命中 · 发默认菜单`);
      const fallbackMenu = `不好意思, 这个问题我暂时没找到对应资料 😅 我主要可以协助您了解:

1. 产品介绍
2. 价格 / 套餐
3. 开通流程
4. 转人工客服

请直接回复编号或您的需求, 我帮您处理~`;
      await this.send(conv, fallbackMenu, {
        mode: 'faq',
        kbId: secondaryKbId ?? primaryKbIds[0] ?? null,
        confidence: 0,
        intent: 'faq_only_fallback_menu',
        handoff: false,
        metadata: {
          faq_only_fallback: true,
          primary_kb_ids: primaryKbIds,
        },
      });
      // 不 markHandoff · 客户回复编号能继续走 (4=转人工 由后续消息匹配 handoff 关键词触发)
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
    // 2026-04-29 · 任务 6+7 · system prompt 全面升级 (SaaS 通用 · 不绑特定行业)
    //   - 销售流程通用化 (了解需求 → 推荐适合方案 → 引导留联系方式)
    //   - 闲聊处理 (简短陪聊 + 拉回业务)
    //   - lead collection (兴趣明显时引导留联系方式 · 具体问什么由 KB 资料决定)
    //   - 转人工话术 (价格/demo/购买/付款/退款/技术问题 自动 handoff=true)
    //   2026-04-29 · SaaS 边界修正:
    //     去掉 "您大概需要多少个号" / "Basic/Pro/Enterprise" 这种 WAhubX 平台自己卖
    //     账号管理产品的话术. 改成通用销售引导 · 具体问什么 (账号数 / 客户人数 / 项目预算 /
    //     课程班次) 由 KB.goalPrompt 和 chunks 内容决定 · LLM 自己看资料推断.
    const systemPrompt = `你是该公司在 WhatsApp 上的智能客服顾问 · 不是单纯说明书机器人.
业务目标: ${goal}

== 风格 ==
- 中文口语化 · 像真人客服微信聊
- 简洁 (≤ ${MAX_REPLY_LENGTH} 字) · 不官方腔
- 适度 emoji (😊 ~ 不滥用)
- 答完带一个自然追问 (推动客户继续说)

== 销售流程 (通用 · 按客户进度引导) ==
1. 客户问候 → 简短自我介绍 + 询问对方想咨询什么
2. 客户问产品 → 根据"资料"做简要介绍 + 询问客户具体需求场景
   (具体问什么由资料内容决定 · 例如卖课程问参加人数 / 卖服务问需求范围 / 卖软件问使用规模)
3. 客户描述需求 → 根据"资料"推荐合适方案 + 引导留联系方式以便顾问详细沟通
4. 客户问价 / 想 demo / 要购买 → 立即转人工 (告诉用户"我帮您转接顾问")
5. 客户表达兴趣 → 引导留 WhatsApp 号 / 称呼 / 公司名 / 具体需求

== 必须转人工的场景 (设 handoff=true) ==
- 客户问具体价格但资料没价格
- 客户要 demo / 演示 / 试用 (没 demo 资料就转)
- 客户说要购买 / 下单 / 报价 / 合同
- 客户投诉 / 付款 / 退款问题
- 客户技术问题 / 服务出问题 / 用不了
- 客户骂人 / 情绪激动
- 客户要求人工 / 真人 / sales / agent / 老板

== 闲聊处理 ==
- 客户问吃饭 / 天气 / 今天累不累 / 你是谁 (跟业务无关) → 简短陪聊一句, 拉回业务
  例: "哈哈, 我主要负责产品咨询的智能客服 😊 您是想了解产品、价格、开通流程, 还是需要我帮您转人工呢?"
- 不要冷漠拒答, 也不要陪聊太多

== 硬规则 ==
- **只根据"资料"内容回答 · 不编造任何信息**
- 资料里有的联系方式 (电话/网址/邮箱) 必须原样保留
- **不报具体价格数字** (资料里也只能说大概范围, 引导转人工确认)
- 不承诺 "100%" / "保证" / "绝对" / "一定"
- 不提及竞品${blackList ? `\n- 禁止话题: ${blackList}` : ''}
${
  targetedKbName
    ? `- 当前产品 = "${targetedKbName}" · 资料里产品名可能跟客户称呼不同 (新旧名/英文名/简称) · 答时统一用客户的称呼 "${targetedKbName}"`
    : ''
}

== 输出 ==
严格 JSON · 不要其他文字:
{
  "reply": "客服回复文字",
  "intent": "curious | interested | buying | pricing | demo | complaint | technical | off_topic | handoff",
  "handoff": true 或 false
}`;

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
  ): Promise<{ faq: KbFaqEntity; score: number; matchedVariant?: string } | null> {
    const faqs = await this.faqRepo.find({
      where: { kbId, status: 'enabled' as const },
    });
    if (faqs.length === 0) return null;

    const qTokens = this.tokenize(question);
    if (qTokens.size === 0) return null;

    const qLang = this.detectLang(question);

    let best: { faq: KbFaqEntity; score: number; matchedVariant?: string } | null = null;
    for (const f of faqs) {
      // 2026-04-29 · 任务 2 · 同时跑 canonical question + 所有 variants · 取最高分
      //   variants 来源: tags 数组里 'var:xxx' 前缀
      //   兼容老 FAQ (没 var: tags) · 仍按 canonical question 单点 jaccard
      const candidates: Array<{ text: string; isVariant: boolean }> = [
        { text: f.question, isVariant: false },
      ];
      const variants = ReplyExecutorService.extractVariantsFromTags(f.tags);
      for (const v of variants) {
        candidates.push({ text: v, isVariant: true });
      }

      const fLangs = this.faqLangs(f);
      let bestForFaq: { score: number; matchedVariant?: string } | null = null;
      for (const c of candidates) {
        const cTokens = this.tokenize(c.text);
        let score = this.jaccard(qTokens, cTokens);
        // 语言加权 (同 commit 65d4749 逻辑 · 同语言 ×1.2, 异语言 ×0.8)
        if (qLang !== 'mixed' && qLang !== 'unknown') {
          if (fLangs.has(qLang)) {
            score *= 1.2;
          } else if (fLangs.size > 0 && !fLangs.has('mixed')) {
            score *= 0.8;
          }
        }
        if (score > 1) score = 1;
        if (!bestForFaq || score > bestForFaq.score) {
          bestForFaq = {
            score,
            matchedVariant: c.isVariant ? c.text : undefined,
          };
        }
      }

      if (bestForFaq && (!best || bestForFaq.score > best.score)) {
        best = { faq: f, score: bestForFaq.score, matchedVariant: bestForFaq.matchedVariant };
      }
    }
    return best;
  }

  // 2026-04-29 · 任务 2 · variants 从 tags 数组抽
  static extractVariantsFromTags(tags: string[] | null | undefined): string[] {
    if (!tags || tags.length === 0) return [];
    const out: string[] = [];
    for (const t of tags) {
      if (typeof t === 'string' && t.startsWith('var:')) {
        const v = t.slice(4).trim();
        if (v) out.push(v);
      }
    }
    return out;
  }

  // 2026-04-29 · 任务 2 · 解析 tags 里其他元数据
  static extractFaqMeta(tags: string[] | null | undefined): {
    intent?: string;
    handoffAction?: string;
    riskLevel?: string;
    followUp?: string;
    variants: string[];
    plainTags: string[];
  } {
    const out: {
      intent?: string;
      handoffAction?: string;
      riskLevel?: string;
      followUp?: string;
      variants: string[];
      plainTags: string[];
    } = { variants: [], plainTags: [] };
    if (!tags) return out;
    for (const t of tags) {
      if (typeof t !== 'string') continue;
      if (t.startsWith('intent:')) out.intent = t.slice(7).trim();
      else if (t.startsWith('handoff:')) out.handoffAction = t.slice(8).trim();
      else if (t.startsWith('risk:')) out.riskLevel = t.slice(5).trim();
      else if (t.startsWith('fu:')) out.followUp = t.slice(3).trim();
      else if (t.startsWith('var:')) out.variants.push(t.slice(4).trim());
      else out.plainTags.push(t);
    }
    return out;
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

  // 2026-04-28 · 简繁体常见字归一化 (zh-Hant → zh-Hans · 仅 FAQ matching 用)
  //   bug: 客户问 "妳好" · starter "你好" tokenize {妳,好} vs {你,好} · jaccard 0.33 < 0.55 ❌
  //   修: tokenize 前把繁体常用字转简体 · 让"妳好"="你好"="您好" 都能命中
  //   注: 不引入 OpenCC 等大库 · 内联常见 50 字够用 · 后续可扩
  // 单字繁→简映射 · 仅 FAQ tokenize 用
  private static readonly TC_TO_SC: Record<string, string> = {
    // 人称
    '妳': '你', '您': '你',
    // 常见繁体单字 (去重)
    '們': '们', '個': '个', '麼': '么', '對': '对', '說': '说',
    '話': '话', '時': '时', '間': '间', '問': '问', '題': '题',
    '產': '产', '價': '价', '錢': '钱', '買': '买', '賣': '卖',
    '單': '单', '號': '号', '聯': '联', '繫': '系', '電': '电',
    '網': '网', '頁': '页', '應': '应', '該': '该', '當': '当',
    '會': '会', '為': '为', '從': '从', '進': '进', '這': '这',
    '裡': '里', '謝': '谢', '請': '请', '幫': '帮', '給': '给',
    '讓': '让', '見': '见', '聽': '听', '愛': '爱', '歡': '欢',
    '訊': '讯', '線': '线', '連': '连', '開': '开', '關': '关',
    '閉': '闭', '處': '处', '報': '报', '貨': '货', '驗': '验',
    '證': '证', '識': '识', '別': '别', '囉': '罗', '哈': '哈',
    '囉嗦': '罗嗦',
  };

  private normalizeZhVariants(s: string): string {
    let out = '';
    for (const ch of s) {
      out += ReplyExecutorService.TC_TO_SC[ch] ?? ch;
    }
    return out;
  }

  private tokenize(s: string): Set<string> {
    // 2026-04-28 · 先做简繁归一化 (修 "妳好" 跟 "你好" 不识别 bug)
    const normalized0 = this.normalizeZhVariants(s);
    // 简单切词: 中文按字 · 英文按词
    const tokens = new Set<string>();
    const normalized = normalized0.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
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
      // 2026-04-29 · 任务 9 · 增强 audit metadata · 复用 jsonb guardrail_edits
      //   字段: matched_variant / product_menu_shown / kb_bound_now / kb_switched
      //         handoff_reason / was_off_topic / faq_only_fallback / primary_kb_ids 等
      metadata?: Record<string, unknown>;
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
        // 更新 conversation 计数 (system_notice/menu 类不算 AI 答 · intent 含 system_notice/product_menu 跳过)
        const intentRaw = meta.intent ?? '';
        const isSystemNotice =
          intentRaw.startsWith('system_notice_') || intentRaw === 'product_menu_shown';
        if (!isSystemNotice) {
          conv.lastAiReplyAt = new Date();
          conv.aiReplyCount24h = (conv.aiReplyCount24h ?? 0) + 1;
          conv.aiReplyCountTotal = (conv.aiReplyCountTotal ?? 0) + 1;
          await this.convRepo.save(conv);
        }
      } catch (err) {
        this.logger.warn(`sendText failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    // 审计 · metadata 写 guardrail_edits jsonb (复用现有字段 · 零 migration)
    await this.auditRepo.save(
      this.auditRepo.create({
        tenantId: conv.tenantId,
        conversationId: conv.id,
        inboundMessage: null, // handle() 入口未传 · 后续可补
        replyText,
        mode: meta.mode,
        kbId: meta.kbId ?? null,
        matchedFaqId: meta.matchedFaqId ?? null,
        matchedChunkIds: meta.matchedChunkIds ?? null,
        confidence: meta.confidence != null ? String(meta.confidence.toFixed(3)) : null,
        model: meta.model ?? null,
        intent: meta.intent ?? null,
        handoffTriggered: meta.handoff,
        guardrailEdits: meta.metadata
          ? (meta.metadata as Record<string, unknown>)
          : null,
        sentMessageId,
        draft: false,
        costTokensIn: meta.costTokensIn ?? 0,
        costTokensOut: meta.costTokensOut ?? 0,
      }),
    );
  }

  // ════════════════════════════════════════════════════════════════
  // 2026-04-29 · 任务 4 · 多产品菜单辅助函数
  // ════════════════════════════════════════════════════════════════

  /** 检查客户消息是不是问候 / 简单短语 (问候应走通用 FAQ · 不发产品菜单) */
  private isGreetingOrSimple(s: string): boolean {
    const trimmed = s.trim().toLowerCase();
    if (trimmed.length === 0) return true;
    if (trimmed.length <= 4) return true; // 太短 (hi / 你好 / 嗨 / 在吗 等)
    const greetingPatterns = [
      /^(hi|hello|hey|您好|你好|妳好|嗨|哈囉|哈罗|在吗|在嗎)[\s!,.]*$/i,
      /^(早|早上好|下午好|晚上好|good\s*(morning|afternoon|evening))[\s!,.]*$/i,
      /^(谢谢|多谢|thanks?|thank\s*you|感谢|ok|好的|嗯|嗯嗯|👍)[\s!,.]*$/i,
      /^(再见|拜拜|88|bye)[\s!,.]*$/i,
      /^(人工|真人|客服|转人工|要人工|找人工|转客服|sales|agent)[\s!,.]*$/i,
    ];
    return greetingPatterns.some((p) => p.test(trimmed));
  }

  /** 解析客户对产品菜单的回复 · 返回选中的 KB 或 null */
  private parseProductMenuReply(
    s: string,
    productKbs: KnowledgeBaseEntity[],
  ): KnowledgeBaseEntity | null {
    const trimmed = s.trim();
    // 数字回复 (1, 2, 3) · 0 索引 + 1 = 编号
    const numMatch = trimmed.match(/^[1-9]\d?$/);
    if (numMatch) {
      const idx = parseInt(numMatch[0], 10) - 1;
      if (idx >= 0 && idx < productKbs.length) return productKbs[idx];
    }
    // 产品名包含 (跟 KB pre-filter 同款 normalize)
    const norm = trimmed.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '');
    if (norm.length >= 2) {
      for (const k of productKbs) {
        const kn = k.name.toLowerCase().replace(/[^a-z0-9一-鿿]/g, '');
        if (kn.length >= 2 && (norm.includes(kn) || kn.includes(norm))) {
          return k;
        }
      }
    }
    return null;
  }

  /** 拿 tenant 名字做菜单开场白 */
  private async getTenantDisplayName(tenantId: number): Promise<string> {
    try {
      const rows = await this.convRepo.query<Array<{ name: string }>>(
        `SELECT name FROM tenant WHERE id = $1 LIMIT 1`,
        [tenantId],
      );
      const name = (rows[0]?.name ?? '').trim();
      return name || '本公司';
    } catch {
      return '本公司';
    }
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
