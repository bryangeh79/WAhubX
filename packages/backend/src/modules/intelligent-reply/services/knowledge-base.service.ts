import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { KnowledgeBaseEntity, KbStatus } from '../entities/knowledge-base.entity';
import { KbSourceEntity, KbSourceKind } from '../entities/kb-source.entity';
import { KbChunkEntity } from '../entities/kb-chunk.entity';
import { KbFaqEntity, FaqSource, FaqStatus } from '../entities/kb-faq.entity';
import { KbProtectedEntity, ProtectedEntityType } from '../entities/kb-protected.entity';
import { FileParserService } from './file-parser.service';
import { PlatformAiService } from './platform-ai.service';
import { AiTextService } from '../../ai/ai-text.service';
import { STARTER_COMMON_FAQ, COMMON_KB_META } from '../data/starter-common-faq';

const DEFAULT_FAQ_QUOTA_PER_MONTH = 20;

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = new Logger(KnowledgeBaseService.name);

  constructor(
    @InjectRepository(KnowledgeBaseEntity)
    private readonly kbRepo: Repository<KnowledgeBaseEntity>,
    @InjectRepository(KbSourceEntity)
    private readonly sourceRepo: Repository<KbSourceEntity>,
    @InjectRepository(KbChunkEntity)
    private readonly chunkRepo: Repository<KbChunkEntity>,
    @InjectRepository(KbFaqEntity)
    private readonly faqRepo: Repository<KbFaqEntity>,
    @InjectRepository(KbProtectedEntity)
    private readonly protectedRepo: Repository<KbProtectedEntity>,
    private readonly parser: FileParserService,
    private readonly platformAi: PlatformAiService,
    private readonly tenantAi: AiTextService,
  ) {}

  // ── CRUD ────────────────────────────────────────

  async list(tenantId: number): Promise<KnowledgeBaseEntity[]> {
    return this.kbRepo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async get(tenantId: number, id: number): Promise<KnowledgeBaseEntity> {
    const row = await this.kbRepo.findOne({ where: { tenantId, id } });
    if (!row) throw new NotFoundException(`知识库 ${id} 不存在`);
    return row;
  }

  async create(
    tenantId: number,
    dto: { name: string; description?: string; goalPrompt?: string; isDefault?: boolean },
  ): Promise<KnowledgeBaseEntity> {
    const exists = await this.kbRepo.findOne({ where: { tenantId, name: dto.name } });
    if (exists) {
      // 2026-04-24 · 若同名 KB 存在且是空壳 (无文档), 复用它 · 避免向导半途失败留下孤儿
      const sourceCount = await this.sourceRepo.count({ where: { kbId: exists.id } });
      if (sourceCount === 0) {
        if (dto.description !== undefined) exists.description = dto.description;
        if (dto.goalPrompt !== undefined) exists.goalPrompt = dto.goalPrompt;
        if (dto.isDefault === true) {
          await this.kbRepo.update({ tenantId }, { isDefault: false });
          exists.isDefault = true;
        }
        return this.kbRepo.save(exists);
      }
      throw new BadRequestException(`知识库 "${dto.name}" 已存在 · 请改名字`);
    }

    if (dto.isDefault) {
      await this.kbRepo.update({ tenantId }, { isDefault: false });
    }
    return this.kbRepo.save(
      this.kbRepo.create({
        tenantId,
        name: dto.name,
        description: dto.description ?? null,
        goalPrompt: dto.goalPrompt ?? null,
        isDefault: dto.isDefault ?? false,
        status: KbStatus.Enabled,
      }),
    );
  }

  async update(
    tenantId: number,
    id: number,
    dto: { name?: string; description?: string; goalPrompt?: string; isDefault?: boolean },
  ): Promise<KnowledgeBaseEntity> {
    const row = await this.get(tenantId, id);
    if (dto.name !== undefined) {
      const dup = await this.kbRepo.findOne({ where: { tenantId, name: dto.name } });
      if (dup && dup.id !== id) throw new BadRequestException(`已有同名知识库`);
      row.name = dto.name;
    }
    if (dto.description !== undefined) row.description = dto.description;
    if (dto.goalPrompt !== undefined) row.goalPrompt = dto.goalPrompt;
    if (dto.isDefault === true) {
      await this.kbRepo.update({ tenantId }, { isDefault: false });
      row.isDefault = true;
    } else if (dto.isDefault === false) {
      row.isDefault = false;
    }
    return this.kbRepo.save(row);
  }

  async remove(tenantId: number, id: number): Promise<void> {
    const row = await this.get(tenantId, id);
    await this.kbRepo.remove(row);
  }

  // ── 文件上传 + 解析 + chunk + embed ─────────────

  async uploadFile(
    tenantId: number,
    kbId: number,
    file: { buffer: Buffer; fileName: string; mime?: string },
  ): Promise<KbSourceEntity> {
    await this.get(tenantId, kbId);
    const parsed = await this.parser.parse(file.buffer, file.fileName, file.mime);

    // 1. 存 source 原文
    const source = await this.sourceRepo.save(
      this.sourceRepo.create({
        kbId,
        fileName: file.fileName,
        mime: file.mime ?? null,
        kind: parsed.kind as KbSourceKind,
        byteSize: file.buffer.length,
        rawText: parsed.text,
      }),
    );

    // 2. 切 chunk
    const chunks = this.parser.chunk(parsed.text, 500, 50);
    if (chunks.length === 0) {
      await this.sourceRepo.update(source.id, {
        errorMsg: '解析出 0 chunk',
        processedAt: new Date(),
      });
      return source;
    }

    // 3. 存 chunk (先不带 embedding)
    const chunkRows = chunks.map((t, i) =>
      this.chunkRepo.create({
        kbId,
        sourceId: source.id,
        chunkIdx: i,
        text: t,
        tokenCount: Math.ceil(t.length / 2),
      }),
    );
    await this.chunkRepo.save(chunkRows);

    // 4. 异步调 embedding · 失败不阻塞
    if (this.platformAi.isEmbedAvailable()) {
      this.embedChunksAsync(chunkRows.map((c) => c.id)).catch((e) =>
        this.logger.warn(`async embed failed: ${e}`),
      );
    }

    // 5. 抽保留实体
    try {
      const entities = this.parser.extractProtectedEntities(parsed.text);
      if (entities.length > 0) {
        const protRows = entities.map((e) =>
          this.protectedRepo.create({
            kbId,
            sourceId: source.id,
            entityType: e.type as ProtectedEntityType,
            value: e.value.slice(0, 512),
          }),
        );
        await this.protectedRepo.save(protRows);
      }
    } catch (err) {
      this.logger.warn(`extractProtected failed: ${err}`);
    }

    // 6. 标记 processed
    await this.sourceRepo.update(source.id, { processedAt: new Date() });
    return source;
  }

  private async embedChunksAsync(chunkIds: number[]): Promise<void> {
    const BATCH = 20;
    for (let i = 0; i < chunkIds.length; i += BATCH) {
      const batch = chunkIds.slice(i, i + BATCH);
      const rows = await this.chunkRepo.find({ where: { id: In(batch) } });
      const texts = rows.map((r) => r.text);
      const res = await this.platformAi.embed(texts);
      if (!res.ok) {
        this.logger.warn(`embed batch failed: ${res.error}`);
        continue;
      }
      for (let j = 0; j < rows.length; j++) {
        rows[j].embedding = res.vectors[j] ?? null;
      }
      await this.chunkRepo.save(rows);
    }
  }

  async listSources(tenantId: number, kbId: number): Promise<KbSourceEntity[]> {
    await this.get(tenantId, kbId);
    return this.sourceRepo.find({
      where: { kbId },
      order: { createdAt: 'DESC' },
    });
  }

  async removeSource(tenantId: number, kbId: number, sourceId: number): Promise<void> {
    await this.get(tenantId, kbId);
    const src = await this.sourceRepo.findOne({ where: { id: sourceId, kbId } });
    if (!src) throw new NotFoundException(`source ${sourceId} 不存在`);
    await this.sourceRepo.remove(src); // chunks CASCADE
  }

  // ── FAQ 管理 ─────────────────────────────────────

  async listFaqs(
    tenantId: number,
    kbId: number,
    filters: { status?: FaqStatus; source?: FaqSource } = {},
  ): Promise<KbFaqEntity[]> {
    await this.get(tenantId, kbId);
    const where: Record<string, unknown> = { kbId };
    if (filters.status) where.status = filters.status;
    if (filters.source) where.source = filters.source;
    return this.faqRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async createFaq(
    tenantId: number,
    kbId: number,
    dto: { question: string; answer: string; tags?: string[] },
  ): Promise<KbFaqEntity> {
    await this.get(tenantId, kbId);
    return this.faqRepo.save(
      this.faqRepo.create({
        kbId,
        question: dto.question.trim(),
        answer: dto.answer.trim(),
        tags: dto.tags ?? [],
        status: 'enabled', // 手动添加默认启用 (租户自己填的, 无需审核)
        source: 'manual_single',
      }),
    );
  }

  async bulkImportFaqs(
    tenantId: number,
    kbId: number,
    items: Array<{ question: string; answer: string; tags?: string[] }>,
  ): Promise<{ added: number; skippedDup: number; skippedInvalid: number }> {
    await this.get(tenantId, kbId);
    let added = 0;
    let skippedDup = 0;
    let skippedInvalid = 0;
    const existing = await this.faqRepo.find({ where: { kbId }, select: ['id', 'question'] });
    const existSet = new Set(existing.map((e) => e.question.trim().toLowerCase()));
    const rows: KbFaqEntity[] = [];
    for (const it of items) {
      const q = (it.question ?? '').trim();
      const a = (it.answer ?? '').trim();
      if (!q || !a || q.length > 500 || a.length > 2000) {
        skippedInvalid++;
        continue;
      }
      if (existSet.has(q.toLowerCase())) {
        skippedDup++;
        continue;
      }
      existSet.add(q.toLowerCase());
      rows.push(
        this.faqRepo.create({
          kbId,
          question: q,
          answer: a,
          tags: it.tags ?? [],
          status: 'enabled',
          source: 'manual_bulk',
        }),
      );
    }
    if (rows.length > 0) {
      await this.faqRepo.save(rows);
      added = rows.length;
    }
    return { added, skippedDup, skippedInvalid };
  }

  async updateFaq(
    tenantId: number,
    kbId: number,
    faqId: number,
    dto: { question?: string; answer?: string; tags?: string[]; status?: FaqStatus },
  ): Promise<KbFaqEntity> {
    await this.get(tenantId, kbId);
    const row = await this.faqRepo.findOne({ where: { id: faqId, kbId } });
    if (!row) throw new NotFoundException(`FAQ ${faqId} 不存在`);
    if (dto.question !== undefined) row.question = dto.question.trim();
    if (dto.answer !== undefined) row.answer = dto.answer.trim();
    if (dto.tags !== undefined) row.tags = dto.tags;
    if (dto.status !== undefined) row.status = dto.status;
    return this.faqRepo.save(row);
  }

  async approveAllDrafts(tenantId: number, kbId: number): Promise<{ updated: number }> {
    await this.get(tenantId, kbId);
    const res = await this.faqRepo.update({ kbId, status: 'draft' }, { status: 'enabled' });
    return { updated: res.affected ?? 0 };
  }

  async removeFaq(tenantId: number, kbId: number, faqId: number): Promise<void> {
    await this.get(tenantId, kbId);
    const row = await this.faqRepo.findOne({ where: { id: faqId, kbId } });
    if (!row) throw new NotFoundException(`FAQ ${faqId} 不存在`);
    await this.faqRepo.remove(row);
  }

  // ── AI 自动生成 FAQ · 用平台 DeepSeek ──────────

  async generateFaqs(
    tenantId: number,
    kbId: number,
    options: { count?: number } = {},
  ): Promise<{ generated: number; skippedDup: number }> {
    const kb = await this.get(tenantId, kbId);
    if (!this.platformAi.isLlmAvailable()) {
      throw new BadRequestException('平台 AI 未配置 · 请联系管理员 · 或手动添加 FAQ');
    }

    // 配额检查 (简化: 本月生成次数 · 从 ai_reply_audit 派生)
    const quota = Number(process.env.PLATFORM_FAQ_QUOTA ?? DEFAULT_FAQ_QUOTA_PER_MONTH);
    // TODO: 实现真正的月度配额 · V1 先不限

    // 取这个 KB 最多 6 个 chunk 作为原料
    const sampleChunks = await this.chunkRepo.find({
      where: { kbId },
      order: { chunkIdx: 'ASC' },
      take: 6,
    });
    if (sampleChunks.length === 0) {
      throw new BadRequestException('该知识库还没有文档 · 请先上传产品介绍');
    }

    const count = options.count ?? 30;
    const material = sampleChunks.map((c) => c.text).join('\n\n---\n\n');
    const goal = kb.goalPrompt?.trim() || '让客户了解产品并留下联系方式';

    // 2026-04-29 · 任务 1+3+10 · FAQ 生成 prompt 升级
    //   - 输出结构化 JSON (canonical_question / variants / intent / handoff_action / follow_up_question / risk_level / tags)
    //   - 区分公司通用 KB 跟产品 KB · 通用 KB 出客服话术 (问候/转人工/价格反问/营业时间), 产品 KB 出产品专属 FAQ
    //   - 风格: 口语化 + 销售引导 + 不报价
    //   - 兼容存储: variants/intent/handoff_action/follow_up_question/risk_level 全部塞 tags 字段
    //     格式: ['intent:pricing', 'handoff:if_no_price', 'risk:medium', 'fu:具体哪方面价格?', 'var:多少钱', 'var:报价', 'var:价位怎么样', 'product_intro']
    //     (上面这些只是数据格式示例 · 实际 LLM 生成的 var/fu 内容由当前 KB 资料决定 · 不绑定 WAhubX 平台)
    //     reply-executor.matchFaq 解析时把 var: 前缀的当 variant 参与匹配
    // 2026-04-29 · SaaS 边界修正:
    //   去掉 "会不会被封 / VPN / IP / 数据安全" 这种 WhatsApp/Facebook 自动化
    //   产品特有疑虑. 改成通用模板 (常见疑虑由 LLM 看 ${kb.name} 实际资料推断).
    //   适用场景包括: 美容/课程/地产/SaaS 软件/电商等任意行业.
    const isCompanyCommonKb = kb.isDefault;
    const kbScopeBlock = isCompanyCommonKb
      ? `**这是公司通用 KB · 你要生成"客服通用话术 FAQ"** (不是产品介绍):
- 问候 (你好 / 晚上好 / 在吗)
- 自我介绍 / 这是哪家公司
- 营业时间 / 客服在不在
- 联系方式 / 怎么找你们
- 价格反问 (客户没说哪个产品就问"多少钱" → 反问哪个产品)
- 介绍一下 (客户没指定产品 → 引导先选产品)
- 转人工 ("人工" / "真人" / "客服")
- 闲聊兜底 (吃饭了吗 / 天气 / 累不累 → 简短陪聊 + 拉回业务)
- 道别 / 感谢
**不要生成产品具体功能 FAQ** (那是产品 KB 的工作)`
      : `**这是产品 KB ("${kb.name}") · 你要生成"该产品专属 FAQ"**:
- 这个产品/服务是做什么的 / 主要价值
- 适合什么客户 / 典型使用场景
- 套餐 / 方案 / 包装区别 (如果资料里有)
- 流程: 怎么开始 / 怎么使用 / 多久见效或上手
- 客户常见疑虑 (从资料推断 · 例如效果 / 周期 / 成本 / 服务范围 / 售后保障 / 风险)
- 注意: 不要从其他行业经验照搬话题 · 严格根据下面的"参考资料"生成
**不要生成通用客服 FAQ** (问候 / 营业时间 / 联系方式 → 公司通用 KB 的工作)`;

    const systemPrompt = `你是资深 WhatsApp 客服话术设计师, 帮 SaaS 公司生成"成交型 FAQ" (不是说明书摘抄).
你支持任意行业租户 (美容 / 课程 / 地产 / SaaS / 电商等), 客户问题和答案要严格基于本次提供的"参考资料", 不要套用其他行业模板.
风格底线:
- 中文口语化 · 像真人客服微信聊天
- 答完带一个自然追问 (推动客户继续说话)
- 可用少量 emoji (😊 ~ 不滥用)
- 不官方腔 / 不机械
- 不承诺 100% / 保证 / 绝对
- 资料里有的联系方式原样保留
- 资料里没有的价格 → 引导留联系方式 + 转人工 (不能编)
- 销售导向: 客户一表现兴趣就引导留联系方式 (具体问什么 — 例如班次 / 项目预算 / 使用规模 / 客户人数 — 由资料决定)`;

    const userPrompt = `
业务目标: ${goal}

${kbScopeBlock}

参考资料:
"""
${material.slice(0, 8000)}
"""

输出要求:
生成 ${count} 条 FAQ · **严格 JSON 格式**, 每条:
{
  "canonical_question": "标准问题 (15 字以内 · 口语化)",
  "variants": ["客户可能这样问 1", "客户可能这样问 2", "客户可能这样问 3"],
  "answer": "亲切口语化答案 (≤120 字 · 含 emoji · 末尾带追问)",
  "intent": "greeting | product_intro | pricing | package | demo | setup | risk | technical_support | refund | payment | complaint | human_agent | off_topic | unclear | lead_collection",
  "handoff_action": "none | always | if_no_price | if_uncertain",
  "follow_up_question": "答完之后的自然追问",
  "risk_level": "low | medium | high",
  "tags": ["关键词 1", "关键词 2"]
}

要求:
- variants 至少 3 个 · 涵盖客户真实可能的问法 (不是改写 canonical_question · 是不同表达)
- 价格相关问题 handoff_action 设 "if_no_price"
- demo / 购买 / 投诉 / 退款 / 付款 / 服务出问题 类 handoff_action 设 "always"
- 风险/疑虑话题 (具体例子 由"参考资料"决定 · 不要套用其他行业的疑虑) risk_level 设 "high"
- 销售场景 (客户表达兴趣 / 询价) intent 设 "lead_collection" 或 "pricing"

返回:
{"faqs":[{...}, {...}, ...]}
`.trim();

    const res = await this.platformAi.llm(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { temperature: 0.6, maxTokens: 8192, jsonMode: true },
    );

    if (!res.ok) {
      throw new BadRequestException(`AI 调用失败: ${res.error ?? 'unknown'}`);
    }

    // 解析新格式 · 兼容老格式 (q/a/tags · 没 variants)
    type NewFaq = {
      canonical_question?: string;
      q?: string;
      variants?: string[];
      answer?: string;
      a?: string;
      intent?: string;
      handoff_action?: string;
      follow_up_question?: string;
      risk_level?: string;
      tags?: string[];
    };
    let faqs: NewFaq[] = [];
    try {
      const parsed = JSON.parse(res.text) as { faqs?: NewFaq[] };
      faqs = parsed.faqs ?? [];
    } catch {
      throw new BadRequestException('AI 返回格式不正确 · 稍后重试');
    }

    // 把 variants/intent/handoff_action/follow_up_question/risk_level 全塞进 tags · 用前缀区分
    // matchFaq() 在 reply-executor 端解析 var: 前缀当 variant 参与 Jaccard
    const buildTags = (f: NewFaq): string[] => {
      const tags: string[] = [];
      if (f.intent) tags.push(`intent:${f.intent.trim()}`);
      if (f.handoff_action) tags.push(`handoff:${f.handoff_action.trim()}`);
      if (f.risk_level) tags.push(`risk:${f.risk_level.trim()}`);
      if (f.follow_up_question?.trim()) {
        // fu 可能含逗号 · base64-safe-ish · 直接塞 (Postgres text[] 单元素能容忍特殊字符)
        tags.push(`fu:${f.follow_up_question.trim().slice(0, 200)}`);
      }
      if (Array.isArray(f.variants)) {
        for (const v of f.variants) {
          const vt = (v ?? '').trim();
          if (vt && vt.length <= 100) tags.push(`var:${vt}`);
        }
      }
      // 普通关键词 tags 也塞 (但跳掉跟前缀冲突的)
      if (Array.isArray(f.tags)) {
        for (const t of f.tags) {
          const tt = (t ?? '').trim();
          if (!tt) continue;
          if (/^(intent|handoff|risk|fu|var):/.test(tt)) continue;
          if (tt.length > 30) continue;
          tags.push(tt);
        }
      }
      // Postgres text[] 单元素长度没硬限 · 但全表 tag 数量保守上限 30
      return tags.slice(0, 30);
    };

    // 去重 (用 canonical_question · 同义 variants 不算重)
    const existing = await this.faqRepo.find({ where: { kbId }, select: ['question'] });
    const existSet = new Set(existing.map((e) => e.question.trim().toLowerCase()));
    let skipped = 0;
    const rows: KbFaqEntity[] = [];
    for (const f of faqs) {
      const q = ((f.canonical_question ?? f.q) ?? '').trim();
      const a = ((f.answer ?? f.a) ?? '').trim();
      if (!q || !a) continue;
      if (existSet.has(q.toLowerCase())) {
        skipped++;
        continue;
      }
      existSet.add(q.toLowerCase());
      rows.push(
        this.faqRepo.create({
          kbId,
          question: q,
          answer: a,
          tags: buildTags(f),
          status: 'draft', // 默认待审核 · 租户一键通过或逐条编辑
          source: 'ai_generated',
        }),
      );
    }
    if (rows.length > 0) await this.faqRepo.save(rows);

    this.logger.log(
      `generateFaqs · tenant=${tenantId} · kb=${kbId} (${isCompanyCommonKb ? '公司通用' : '产品'}) · 生成 ${rows.length} / 请求 ${count} · 跳重 ${skipped} · tokens=${res.promptTokens}+${res.completionTokens}`,
    );

    void quota;
    return { generated: rows.length, skippedDup: skipped };
  }

  // ── 受保护实体 ───────────────────────────────────

  async listProtected(tenantId: number, kbId: number): Promise<KbProtectedEntity[]> {
    await this.get(tenantId, kbId);
    return this.protectedRepo.find({ where: { kbId } });
  }

  async addProtected(
    tenantId: number,
    kbId: number,
    entityType: ProtectedEntityType,
    value: string,
  ): Promise<KbProtectedEntity> {
    await this.get(tenantId, kbId);
    return this.protectedRepo.save(
      this.protectedRepo.create({ kbId, entityType, value: value.slice(0, 512) }),
    );
  }

  async removeProtected(tenantId: number, kbId: number, id: number): Promise<void> {
    await this.get(tenantId, kbId);
    const row = await this.protectedRepo.findOne({ where: { id, kbId } });
    if (!row) throw new NotFoundException(`entity ${id} 不存在`);
    await this.protectedRepo.remove(row);
  }

  // ── 统计 ────────────────────────────────────────

  async getStats(tenantId: number, kbId: number) {
    await this.get(tenantId, kbId);
    const [sources, chunks, faqs, entities] = await Promise.all([
      this.sourceRepo.count({ where: { kbId } }),
      this.chunkRepo.count({ where: { kbId } }),
      this.faqRepo.count({ where: { kbId } }),
      this.protectedRepo.count({ where: { kbId } }),
    ]);
    const faqDraft = await this.faqRepo.count({ where: { kbId, status: 'draft' } });
    const faqEnabled = await this.faqRepo.count({ where: { kbId, status: 'enabled' } });
    return { sources, chunks, faqs, faqDraft, faqEnabled, entities };
  }

  // ── 通用 FAQ starter ────────────────────────────────────
  // 2026-04-28 · 用户高频用 · 必须可重新种子化 · 也支持 AI 优化

  /**
   * 给 KB 灌 starter FAQ (52 条问候/身份/转人工等通用问答)
   * idempotent · 已存在的 question 不重复插
   * 如果该 tenant 还没 default KB · 自动建一个并设为 default
   *
   * 返回: { kbId, inserted, skipped, created (true=新建了 KB) }
   */
  async seedCommonFaqs(
    tenantId: number,
    targetKbId?: number,
  ): Promise<{ kbId: number; inserted: number; skipped: number; created: boolean }> {
    let kbId = targetKbId ?? 0;
    let created = false;

    if (!kbId) {
      // 找 tenant 的 default KB
      const def = await this.kbRepo.findOne({ where: { tenantId, isDefault: true } });
      if (def) {
        kbId = def.id;
      } else {
        // 没 default · 看有没有同名 KB
        const sameName = await this.kbRepo.findOne({
          where: { tenantId, name: COMMON_KB_META.name },
        });
        if (sameName) {
          sameName.isDefault = true;
          await this.kbRepo.save(sameName);
          kbId = sameName.id;
        } else {
          // 真新建
          const newKb = await this.kbRepo.save(
            this.kbRepo.create({
              tenantId,
              name: COMMON_KB_META.name,
              description: COMMON_KB_META.description,
              goalPrompt: COMMON_KB_META.goalPrompt,
              language: COMMON_KB_META.language,
              isDefault: true,
              status: KbStatus.Enabled,
            }),
          );
          kbId = newKb.id;
          created = true;
        }
      }
    } else {
      // 验 KB 归属
      await this.get(tenantId, kbId);
    }

    // 灌 FAQ · 跳已存在 question
    let inserted = 0;
    let skipped = 0;
    for (const faq of STARTER_COMMON_FAQ) {
      const exist = await this.faqRepo.findOne({ where: { kbId, question: faq.question } });
      if (exist) {
        skipped++;
        continue;
      }
      await this.faqRepo.save(
        this.faqRepo.create({
          kbId,
          question: faq.question,
          answer: faq.answer,
          tags: faq.tags,
          status: 'enabled' as FaqStatus,
          source: 'manual_bulk' as FaqSource,
        }),
      );
      inserted++;
    }

    this.logger.log(
      `seedCommonFaqs · tenant=${tenantId} kb=${kbId} created=${created} inserted=${inserted} skipped=${skipped}`,
    );
    return { kbId, inserted, skipped, created };
  }

  /**
   * 用 AI (租户配的 provider) 把 starter FAQ 改写得贴合 tenant 自己的业务
   * - 拉 tenant 的产品 KB description / goal_prompt 作为 context
   * - 对每条带 'starter' tag 的 FAQ · 让 AI 改写 answer
   * - 改完 tag 加上 'starter-customized' (UI 显蓝色"AI 优化"标)
   *
   * 返回: { processed, updated, skipped, failed }
   */
  async customizeStarterFaqs(
    tenantId: number,
    kbId: number,
  ): Promise<{ processed: number; updated: number; skipped: number; failed: number }> {
    await this.get(tenantId, kbId); // 验权限

    // 1. 收集业务 context (tenant 其他 product KB 的 description + goal)
    const productKbs = await this.kbRepo.find({
      where: { tenantId },
    });
    const businessContext = productKbs
      .filter((k) => k.id !== kbId) // 排除当前通用 KB 自己
      .map((k) => `[KB: ${k.name}] ${k.description ?? ''}\n目标: ${k.goalPrompt ?? ''}`)
      .join('\n\n');

    if (!businessContext.trim()) {
      throw new BadRequestException(
        '没有产品 KB 可作为业务上下文 · 请先建 1 个产品 KB 并填描述',
      );
    }

    // 2. 拉本 KB 的 starter FAQ (tags 含 'starter' · 排除已 customized 的)
    const allFaqs = await this.faqRepo.find({ where: { kbId } });
    const starterFaqs = allFaqs.filter(
      (f) =>
        Array.isArray(f.tags) &&
        f.tags.includes('starter') &&
        !f.tags.includes('starter-customized'),
    );

    if (starterFaqs.length === 0) {
      return { processed: 0, updated: 0, skipped: 0, failed: 0 };
    }

    let updated = 0;
    let failed = 0;

    // 3. 对每条 FAQ 调 AI 改写 (单条单调用 · 控成本 + 容错)
    for (const faq of starterFaqs) {
      const systemPrompt = `你是一个客服 FAQ 优化助手. 根据公司业务上下文 · 把通用 FAQ 答案改写得更贴合公司. 要求:
- 友善亲切 · 口语化
- 不超过 80 字
- 保留关键引导信息 (如让用户提供订单号 / 转人工等)
- 自然不生硬 · 不要太营销
- 直接输出新答案 · 不要解释 · 不要 JSON`;

      const userPrompt = `公司业务上下文:
${businessContext.slice(0, 2000)}

通用 FAQ 问题: ${faq.question}
默认答案: ${faq.answer}

请改写答案 (直接输出文本):`;

      try {
        const r = await this.tenantAi.chatWithTenant({
          systemPrompt,
          userPrompt,
          maxTokens: 200,
          timeoutMs: 30_000,
        });
        if (!r.ok) {
          failed++;
          this.logger.warn(`customizeStarterFaqs · faq ${faq.id} · AI 失败: ${r.errorCode}`);
          continue;
        }
        let newAnswer = (r.text ?? '').trim();
        // 简单 sanity: 长度 + 防 AI 输出明显格式错误
        if (newAnswer.length < 5 || newAnswer.length > 500) {
          failed++;
          continue;
        }
        // 截 200 字防 guardrail
        if (newAnswer.length > 200) newAnswer = newAnswer.slice(0, 200);

        // 更新 FAQ · 加 starter-customized tag · 保留原 starter tag 兼容
        const newTags = Array.from(new Set([...(faq.tags ?? []), 'starter-customized']));
        await this.faqRepo.update(faq.id, {
          answer: newAnswer,
          tags: newTags,
        });
        updated++;
      } catch (err) {
        failed++;
        this.logger.warn(
          `customizeStarterFaqs · faq ${faq.id} · 异常: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    this.logger.log(
      `customizeStarterFaqs · tenant=${tenantId} kb=${kbId} processed=${starterFaqs.length} updated=${updated} failed=${failed}`,
    );
    return {
      processed: starterFaqs.length,
      updated,
      skipped: starterFaqs.length - updated - failed,
      failed,
    };
  }
}
