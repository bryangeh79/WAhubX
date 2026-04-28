// 2026-04-29 · AI 智能客服 dry-run debug service
//
// 职责:
//   1. 接受 admin 注入的"模拟客户消息" (tenant_id, message, phone, mode override)
//   2. ensure 测试 conversation (复用现有 customer_conversation 或建一个临时的)
//   3. 跑前置闸门 (handoff 关键词 · 跟 decider 一致 · 复用 checkHandoffKeyword)
//   4. 调 reply-executor.handle({ dryRun: true, traceRef })
//      → executor 内部各分支填 traceRef · send/markHandoff 跳真发但写 audit (draft=true)
//   5. 返完整决策 trace 给 controller 回传 admin
//
// 边界:
//   - 不进 8s 聚合窗 (decider 那边的) · 直接调 executor.handle
//   - 不真发 WA · 不污染真客户对话 · audit draft=true 标记 + guardrail_edits.dryRun=true
//   - 复用现有 reply-executor / decider 逻辑 · 0 重复定义

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ConversationStage,
  CustomerConversationEntity,
} from '../entities/customer-conversation.entity';
import { KnowledgeBaseEntity } from '../entities/knowledge-base.entity';
import { TenantEntity } from '../../tenants/tenant.entity';
import { ReplyExecutorService, type DryRunTrace } from './reply-executor.service';
import { TenantReplySettingsService } from './tenant-reply-settings.service';
import { checkHandoffKeyword } from './auto-reply-decider.service';

export interface DryRunInput {
  tenantId: number;
  /** 模拟客户消息内容 */
  message: string;
  /** 客户号 (E.164) · 用作 tenant 内 conv 唯一键. 同一 phone 多次 dry-run 会绕过历史 conv state */
  phoneE164?: string;
  /** mode override · 不传则用 tenant_reply_settings.mode */
  mode?: 'off' | 'faq' | 'smart';
  /** 显式指定 conv.kb_id (绑定到某产品 KB · 测试 KB-targeted 路径) */
  kbId?: number;
  /** 额外设置 · 强制 conv stage (默认 'new') */
  forceStage?: ConversationStage;
  /** debug 是否要复用同 phone 的真 conv (默认建临时 conv id) */
  reuseRealConversation?: boolean;
  /** 必须 send=false (默认), send=true 不被允许 (本 service 永远 dryRun) */
  send?: boolean;
}

export interface DryRunResult {
  ok: boolean;
  reply?: string | null;
  tenantId: number;
  conversationId: number | null;
  conversationIsTemporary: boolean;
  modeResolved?: string;
  kbId?: number | null;
  kbName?: string | null;
  matchedFaqId?: number | null;
  matchedVariant?: string | null;
  intent?: string | null;
  confidence?: number | null;
  handoff: boolean;
  handoffReason?: string | null;
  productMenuShown: boolean;
  usedCommonKbEarly: boolean;
  isKbExplicitlyTargeted?: boolean;
  primaryKbIds?: number[];
  secondaryKbId?: number | null;
  ragChunks?: Array<{ chunkId: number; kbId: number; score: number; preview: string }>;
  llmProvider?: string | null;
  llmModel?: string | null;
  auditId?: number | null;
  steps: string[];
  /** decider 前置闸门: handoff 关键词命中 · 命中则不进 executor */
  handoffKeywordHit?: string | null;
  /** 当前 tenant 的 KB pool · 让运维看到 SaaS 边界 */
  kbPool: {
    defaultKbId: number | null;
    defaultKbName: string | null;
    productKbs: Array<{ id: number; name: string }>;
  };
  /** 输入回显 */
  echo: {
    tenantId: number;
    message: string;
    phoneE164: string;
    mode: string;
  };
}

@Injectable()
export class ReplyDebugService {
  private readonly logger = new Logger(ReplyDebugService.name);

  constructor(
    @InjectRepository(CustomerConversationEntity)
    private readonly convRepo: Repository<CustomerConversationEntity>,
    @InjectRepository(KnowledgeBaseEntity)
    private readonly kbRepo: Repository<KnowledgeBaseEntity>,
    @InjectRepository(TenantEntity)
    private readonly tenantRepo: Repository<TenantEntity>,
    private readonly executor: ReplyExecutorService,
    private readonly settings: TenantReplySettingsService,
  ) {}

  async dryRun(input: DryRunInput): Promise<DryRunResult> {
    if (input.send === true) {
      throw new BadRequestException('dry-run service forbids send=true · 用真接管页面或客服流程');
    }
    if (!input.tenantId || !input.message || input.message.trim().length === 0) {
      throw new BadRequestException('tenantId 和 message 必填');
    }

    const tenantId = input.tenantId;
    const message = input.message.trim();
    const phoneE164 = (input.phoneE164 ?? '0000000000').replace(/[^\d]/g, '') || '0000000000';
    const mode = input.mode ?? null;

    // 1. 验证 tenant 存在
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new BadRequestException(`tenant ${tenantId} 不存在`);

    // 2. 拉 KB pool (供 trace + result.kbPool 用)
    const allKbs = await this.kbRepo.find({
      where: { tenantId, status: 1 },
      order: { id: 'ASC' },
    });
    const defaultKb = allKbs.find((k) => k.isDefault) ?? null;
    const productKbs = allKbs.filter((k) => !k.isDefault);

    // 3. mode override · 临时改 settings (本次调用结束后还原)
    const realSettings = await this.settings.get(tenantId);
    let originalMode: 'off' | 'faq' | 'smart' | null = null;
    if (mode && mode !== realSettings.mode) {
      originalMode = realSettings.mode;
      await this.settings.update(tenantId, { mode });
      this.logger.log(`dry-run · tenant ${tenantId} · 临时改 mode ${originalMode} → ${mode}`);
    }

    let conv: CustomerConversationEntity | null = null;
    let conversationIsTemporary = false;
    const trace: DryRunTrace = { steps: [] };

    try {
      // 4. ensure conv (复用 executor.ensureConversation 是 decider 的方法 · 这里直接用 SQL upsert)
      const tenantSlots = await this.convRepo.query<Array<{ id: number }>>(
        `SELECT id FROM account_slot WHERE tenant_id = $1 ORDER BY id LIMIT 1`,
        [tenantId],
      );
      // 没 slot 也 OK · 用 0 做占位 (dry-run 不真发就不需要 slot)
      const slotId = tenantSlots[0]?.id ?? 0;

      if (input.reuseRealConversation) {
        conv = await this.convRepo.findOne({
          where: { tenantId, slotId, phoneE164 },
        });
      }
      if (!conv) {
        // 建临时 conv · 用 phone='dry_run_<random>' 区分真客户
        const tempPhone = `dry_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
        conv = await this.convRepo.save(
          this.convRepo.create({
            tenantId,
            slotId,
            phoneE164: tempPhone,
            stage: input.forceStage ?? ConversationStage.New,
            kbId: input.kbId ?? null,
            openedAt: new Date(),
          }),
        );
        conversationIsTemporary = true;
        trace.steps?.push(`create temp conv · id=${conv.id} · phone=${tempPhone}`);
      } else if (input.forceStage && conv.stage !== input.forceStage) {
        conv.stage = input.forceStage;
        await this.convRepo.save(conv);
        trace.steps?.push(`force conv stage = ${input.forceStage}`);
      }

      // 5. 跑前置闸门 (decider 的 handoff 关键词)
      const handoffKeyword = checkHandoffKeyword(message);
      if (handoffKeyword) {
        // 模拟 decider 直接 markHandoff · 不进 executor
        trace.steps?.push(`handoff keyword 命中: "${handoffKeyword}" → 直接转人工 (decider 拦截)`);
        trace.modeResolved = 'handoff_l1_decider';
        trace.handoffTriggered = true;
        trace.handoffReason = `level1 keyword: ${handoffKeyword}`;
        return this.buildResult(input, message, phoneE164, conv, conversationIsTemporary, trace, defaultKb, productKbs, handoffKeyword, mode ?? realSettings.mode);
      }

      // 6. 调 executor · dryRun=true · trace 收集决策详情
      await this.executor.handle(conv.id, message, [], {
        dryRun: true,
        traceRef: trace,
      });

      // 7. 构 result
      return this.buildResult(input, message, phoneE164, conv, conversationIsTemporary, trace, defaultKb, productKbs, null, mode ?? realSettings.mode);
    } finally {
      // 8. 还原 mode
      if (originalMode) {
        await this.settings.update(tenantId, { mode: originalMode });
        this.logger.log(`dry-run · tenant ${tenantId} · 还原 mode → ${originalMode}`);
      }
      // 9. 临时 conv 清理 (可选 · 默认保留方便后续看 audit)
      if (conv && conversationIsTemporary && !input.reuseRealConversation) {
        // 不删 conv · 留着让 audit 能查 · 用户后续手动清
        this.logger.debug?.(`dry-run · tenant ${tenantId} · 临时 conv ${conv.id} 保留 (audit 关联)`);
      }
    }
  }

  private buildResult(
    input: DryRunInput,
    message: string,
    phoneE164: string,
    conv: CustomerConversationEntity | null,
    conversationIsTemporary: boolean,
    trace: DryRunTrace,
    defaultKb: KnowledgeBaseEntity | null,
    productKbs: KnowledgeBaseEntity[],
    handoffKeywordHit: string | null,
    modeResolved: string,
  ): DryRunResult {
    return {
      ok: true,
      reply: trace.replyText ?? null,
      tenantId: input.tenantId,
      conversationId: conv?.id ?? null,
      conversationIsTemporary,
      modeResolved: trace.modeResolved,
      kbId: trace.kbId ?? null,
      kbName: trace.kbName ?? null,
      matchedFaqId: trace.matchedFaqId ?? null,
      matchedVariant: trace.matchedVariant ?? null,
      intent: trace.intent ?? null,
      confidence: trace.confidence ?? null,
      handoff: trace.handoffTriggered ?? false,
      handoffReason: trace.handoffReason ?? null,
      productMenuShown: trace.productMenuShown ?? false,
      usedCommonKbEarly: trace.usedCommonKbEarly ?? false,
      isKbExplicitlyTargeted: trace.isKbExplicitlyTargeted,
      primaryKbIds: trace.primaryKbIds,
      secondaryKbId: trace.secondaryKbId,
      ragChunks: trace.ragChunks,
      llmProvider: trace.llmProvider ?? null,
      llmModel: trace.llmModel ?? null,
      auditId: trace.auditId ?? null,
      steps: trace.steps ?? [],
      handoffKeywordHit,
      kbPool: {
        defaultKbId: defaultKb?.id ?? null,
        defaultKbName: defaultKb?.name ?? null,
        productKbs: productKbs.map((k) => ({ id: k.id, name: k.name })),
      },
      echo: {
        tenantId: input.tenantId,
        message,
        phoneE164,
        mode: modeResolved,
      },
    };
  }
}
