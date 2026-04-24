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

    const systemPrompt = `你是产品运营专家. 根据提供的产品资料, 生成客户最可能在 WhatsApp 咨询中问的问题 + 回答.`;
    const userPrompt = `
业务目标: ${goal}

产品资料:
"""
${material.slice(0, 8000)}
"""

要求:
1. 生成 ${count} 条高质量 Q/A · 覆盖产品功能/价格/售后/联系方式等维度
2. Q 口语化 (像客户真的问出来, 15 字以内)
3. A 友善简洁 · 100 字内 · 可带 emoji
4. 保留资料里出现的电话/网站/邮箱等联系方式 (原样引用)
5. 不编造资料里没有的信息 · 不承诺具体价格数字

返回 JSON (严格格式):
{"faqs":[{"q":"问题","a":"回答","tags":["标签"]}]}
`.trim();

    const res = await this.platformAi.llm(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { temperature: 0.5, maxTokens: 4096, jsonMode: true },
    );

    if (!res.ok) {
      throw new BadRequestException(`AI 调用失败: ${res.error ?? 'unknown'}`);
    }

    let faqs: Array<{ q: string; a: string; tags?: string[] }> = [];
    try {
      const parsed = JSON.parse(res.text) as { faqs?: Array<{ q: string; a: string; tags?: string[] }> };
      faqs = parsed.faqs ?? [];
    } catch {
      throw new BadRequestException('AI 返回格式不正确 · 稍后重试');
    }

    // 去重 + 存 draft
    const existing = await this.faqRepo.find({ where: { kbId }, select: ['question'] });
    const existSet = new Set(existing.map((e) => e.question.trim().toLowerCase()));
    let skipped = 0;
    const rows: KbFaqEntity[] = [];
    for (const f of faqs) {
      const q = (f.q ?? '').trim();
      const a = (f.a ?? '').trim();
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
          tags: Array.isArray(f.tags) ? f.tags.slice(0, 5) : [],
          status: 'draft', // 默认待审核 · 租户一键通过或逐条编辑
          source: 'ai_generated',
        }),
      );
    }
    if (rows.length > 0) await this.faqRepo.save(rows);

    this.logger.log(
      `generateFaqs · tenant=${tenantId} · kb=${kbId} · 生成 ${rows.length} / 请求 ${count} · 跳重 ${skipped} · tokens=${res.promptTokens}+${res.completionTokens}`,
    );

    // 引用 quota 避免 lint warning (TODO 实现时用)
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
}
