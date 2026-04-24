import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  OpeningLineEntity,
  OpeningLineStatus,
  type OpeningLineVariant,
} from '../entities/opening-line.entity';
import {
  CreateOpeningLineDto,
  UpdateOpeningLineDto,
} from '../dto/opening-line.dto';
import { AiTextService } from '../../ai/ai-text.service';
import { AiSettingsService } from '../../ai/ai-settings.service';

@Injectable()
export class OpeningLinesService {
  private readonly logger = new Logger(OpeningLinesService.name);

  constructor(
    @InjectRepository(OpeningLineEntity)
    private readonly repo: Repository<OpeningLineEntity>,
    private readonly aiText: AiTextService,
    private readonly aiSettings: AiSettingsService,
  ) {}

  async list(tenantId: number): Promise<OpeningLineEntity[]> {
    return this.repo.find({ where: { tenantId }, order: { createdAt: 'DESC' } });
  }

  async findEnabled(tenantId: number, ids: number[]): Promise<OpeningLineEntity[]> {
    if (ids.length === 0) return [];
    return this.repo
      .createQueryBuilder('o')
      .where('o.tenant_id = :tenantId', { tenantId })
      .andWhere('o.id IN (:...ids)', { ids })
      .andWhere('o.status = :st', { st: OpeningLineStatus.Enabled })
      .getMany();
  }

  async findById(tenantId: number, id: number): Promise<OpeningLineEntity> {
    const row = await this.repo.findOne({ where: { tenantId, id } });
    if (!row) throw new NotFoundException(`开场白 ${id} 不存在`);
    return row;
  }

  async create(tenantId: number, dto: CreateOpeningLineDto): Promise<OpeningLineEntity> {
    return this.repo.save(
      this.repo.create({
        tenantId,
        name: dto.name,
        content: dto.content,
        aiEnabled: dto.aiEnabled ?? false,
        variants: [],
        status: OpeningLineStatus.Enabled,
      }),
    );
  }

  async update(tenantId: number, id: number, dto: UpdateOpeningLineDto): Promise<OpeningLineEntity> {
    const row = await this.findById(tenantId, id);
    if (dto.name !== undefined) row.name = dto.name;
    if (dto.content !== undefined) row.content = dto.content;
    if (dto.aiEnabled !== undefined) row.aiEnabled = dto.aiEnabled;
    if (dto.variants !== undefined) {
      row.variants = dto.variants.map((v, i) => ({
        index: i + 1,
        content: v.content,
        enabled: v.enabled,
      }));
    }
    if (dto.status !== undefined) row.status = dto.status;
    return this.repo.save(row);
  }

  async remove(tenantId: number, id: number): Promise<void> {
    const row = await this.findById(tenantId, id);
    await this.repo.remove(row);
  }

  /**
   * 2026-04-24 · AI 生成变体池 (跟广告对齐)
   * append=false: 清空重生成
   * append=true:  追加, 最多 30
   */
  async generateVariants(
    tenantId: number,
    id: number,
    count = 10,
    append = false,
  ): Promise<OpeningLineEntity> {
    const row = await this.findById(tenantId, id);
    if (!row.content || row.content.trim().length === 0) {
      throw new BadRequestException('开场白内容为空 · 无法生成变体');
    }
    const enabled = await this.aiSettings.isTextEnabled();
    if (!enabled) {
      throw new BadRequestException(
        'AI 文本功能未启用 · 请先到 设置 → AI 配置 启用并配置 API Key',
      );
    }

    const existing = append ? [...(row.variants ?? [])] : [];
    const MAX_TOTAL = 30;
    if (append && existing.length >= MAX_TOTAL) {
      throw new BadRequestException(`变体池已达上限 ${MAX_TOTAL} 条 · 请先删除部分再追加`);
    }

    // 2026-04-24 · 营销人设 + 开场白专用 user prompt (短 · 自然 · 适合 WA)
    const marketingPrompt = await this.aiSettings.getMarketingPrompt();
    const userPrompt = [
      '请基于下面这句开场白, 写一条变体. 只返回新句子, 不加引号或解释.',
      '',
      '原文:',
      row.content,
      '',
      '要求:',
      '- 适合 WhatsApp 作为开场问候 · 自然 · 不要太长 · 不生硬',
      '- 保持原意和风格',
      '- 若含联系方式一律原样保留',
    ].join('\n');

    const tasks = Array.from({ length: count }, () =>
      this.aiText.rewrite(
        {
          originalText: row.content,
          maxTokens: 150,
          timeoutMs: 15_000,
          systemPromptOverride: marketingPrompt,
          userPromptOverride: userPrompt,
        },
        true,
      ),
    );
    const results = await Promise.allSettled(tasks);

    const newVariants: OpeningLineVariant[] = [];
    let idx = existing.length + 1;
    const dedupeSet = new Set(existing.map((v) => v.content.trim()));
    dedupeSet.add(row.content.trim());

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value && r.value.ok) {
        const text = r.value.text.trim();
        if (text.length > 0 && !dedupeSet.has(text)) {
          dedupeSet.add(text);
          newVariants.push({ index: idx++, content: text, enabled: true });
          if (existing.length + newVariants.length >= MAX_TOTAL) break;
        }
      }
    }

    if (newVariants.length === 0) {
      throw new BadRequestException(
        append
          ? 'AI 返回的变体全部重复或为空 · 建议先调整原文再追加'
          : 'AI 生成失败或返回空 · 请检查 AI 配置或稍后重试',
      );
    }

    row.variants = [...existing, ...newVariants];
    row.aiEnabled = true;
    const saved = await this.repo.save(row);
    this.logger.log(
      `开场白 ${id} ${append ? '追加' : '生成'} ${newVariants.length}/${count} 条 AI 变体 · 池共 ${row.variants.length} 条 (tenant=${tenantId})`,
    );
    return saved;
  }

  /**
   * 发送时从变体池抽 1 条 · ai_enabled + 非空 variants 才抽 · 否则用原文
   */
  pickRandomContent(row: OpeningLineEntity): string {
    if (!row.aiEnabled) return row.content;
    const active = (row.variants ?? []).filter((v) => v.enabled && v.content?.trim());
    if (active.length === 0) return row.content;
    return active[Math.floor(Math.random() * active.length)].content;
  }
}
