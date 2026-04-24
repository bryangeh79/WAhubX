import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AdvertisementEntity,
  AdvertisementStatus,
  type AdvertisementVariant,
} from '../entities/advertisement.entity';
import {
  CreateAdvertisementDto,
  UpdateAdvertisementDto,
} from '../dto/advertisement.dto';
import { AiTextService } from '../../ai/ai-text.service';
import { AiSettingsService } from '../../ai/ai-settings.service';

@Injectable()
export class AdvertisementsService {
  private readonly logger = new Logger(AdvertisementsService.name);

  constructor(
    @InjectRepository(AdvertisementEntity)
    private readonly repo: Repository<AdvertisementEntity>,
    private readonly aiText: AiTextService,
    private readonly aiSettings: AiSettingsService,
  ) {}

  async list(tenantId: number): Promise<AdvertisementEntity[]> {
    return this.repo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async findEnabled(tenantId: number, ids: number[]): Promise<AdvertisementEntity[]> {
    if (ids.length === 0) return [];
    return this.repo
      .createQueryBuilder('a')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.id IN (:...ids)', { ids })
      .andWhere('a.status = :st', { st: AdvertisementStatus.Enabled })
      .getMany();
  }

  async findById(tenantId: number, id: number): Promise<AdvertisementEntity> {
    const row = await this.repo.findOne({ where: { tenantId, id } });
    if (!row) throw new NotFoundException(`广告 ${id} 不存在`);
    return row;
  }

  async create(tenantId: number, dto: CreateAdvertisementDto): Promise<AdvertisementEntity> {
    const ad = this.repo.create({
      tenantId,
      name: dto.name,
      content: dto.content,
      assetId: dto.assetId ?? null,
      aiEnabled: dto.aiEnabled ?? false,
      variants: [],
      status: AdvertisementStatus.Enabled,
    });
    return this.repo.save(ad);
  }

  async update(
    tenantId: number,
    id: number,
    dto: UpdateAdvertisementDto,
  ): Promise<AdvertisementEntity> {
    const ad = await this.findById(tenantId, id);
    if (dto.name !== undefined) ad.name = dto.name;
    if (dto.content !== undefined) ad.content = dto.content;
    if (dto.assetId !== undefined) ad.assetId = dto.assetId;
    if (dto.aiEnabled !== undefined) ad.aiEnabled = dto.aiEnabled;
    if (dto.variants !== undefined) {
      // 租户编辑后保存 · 重新索引 (1..N)
      ad.variants = dto.variants.map((v, i) => ({
        index: i + 1,
        content: v.content,
        enabled: v.enabled,
      }));
    }
    if (dto.status !== undefined) ad.status = dto.status;
    return this.repo.save(ad);
  }

  async remove(tenantId: number, id: number): Promise<void> {
    const ad = await this.findById(tenantId, id);
    await this.repo.remove(ad);
  }

  /**
   * 2026-04-24 · 调 AI 批量生成变体
   * - append=false (默认): 替换原池
   * - append=true: 追加到现有池 (重复的会自动去重)
   * - 并发调用 count 次 aiText.rewrite
   * - 失败的变体跳过, 最终数量可能 < count
   * - 至少 1 条成功才保存, 否则 throw
   * - 总数不超过 30 (防止无限累加)
   */
  async generateVariants(
    tenantId: number,
    id: number,
    count = 10,
    append = false,
  ): Promise<AdvertisementEntity> {
    const ad = await this.findById(tenantId, id);
    if (!ad.content || ad.content.trim().length === 0) {
      throw new BadRequestException('广告文案为空 · 无法生成变体');
    }
    const enabled = await this.aiSettings.isTextEnabled();
    if (!enabled) {
      throw new BadRequestException(
        'AI 文本功能未启用 · 请先到 设置 → AI 配置 启用并配置 API Key',
      );
    }

    const existing = append ? [...(ad.variants ?? [])] : [];
    const MAX_TOTAL = 30;
    if (append && existing.length >= MAX_TOTAL) {
      throw new BadRequestException(`变体池已达上限 ${MAX_TOTAL} 条 · 请先删除部分再追加`);
    }

    // 2026-04-24 · 用租户配置的营销人设 + 明确的广告变体 user prompt
    const marketingPrompt = await this.aiSettings.getMarketingPrompt();
    const userPrompt = [
      '请基于下面这段广告文案, 重新写一条变体, 只返回新文案, 不要加引号、解释或"变体 X:"前缀.',
      '',
      '原文:',
      ad.content,
      '',
      '要求:',
      '- 保留原意和关键信息',
      '- 换一种表达方式, 避免跟原文太像',
      '- 若原文含 WhatsApp 链接 / 电话 / 网站 / 公司名等联系方式, 必须 100% 原样保留',
      '- 长度和原文相近, 不要过长',
    ].join('\n');

    const tasks = Array.from({ length: count }, () =>
      this.aiText.rewrite(
        {
          originalText: ad.content,
          maxTokens: 400,
          timeoutMs: 20_000,
          systemPromptOverride: marketingPrompt,
          userPromptOverride: userPrompt,
        },
        true,
      ),
    );
    const results = await Promise.allSettled(tasks);

    const newVariants: AdvertisementVariant[] = [];
    let idx = existing.length + 1;
    const existingContents = new Set(existing.map((v) => v.content.trim()));
    existingContents.add(ad.content.trim()); // 原文也算已有, 避免变体跟它重复

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value && r.value.ok) {
        const text = r.value.text.trim();
        if (text.length > 0 && !existingContents.has(text)) {
          existingContents.add(text);
          newVariants.push({ index: idx++, content: text, enabled: true });
          if (existing.length + newVariants.length >= MAX_TOTAL) break; // 封顶 30
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

    ad.variants = [...existing, ...newVariants];
    ad.aiEnabled = true;
    const saved = await this.repo.save(ad);
    this.logger.log(
      `广告 ${id} ${append ? '追加' : '生成'} ${newVariants.length}/${count} 条 AI 变体 · 池共 ${ad.variants.length} 条 (tenant=${tenantId})`,
    );
    return saved;
  }

  /**
   * 随机抽 1 条变体文案 · 给 send-ad.executor 用
   * - ai_enabled + variants 非空 · 从 enabled 的变体里随机挑 1
   * - 否则返回原 content
   */
  pickRandomContent(ad: AdvertisementEntity): string {
    if (!ad.aiEnabled) return ad.content;
    const active = (ad.variants ?? []).filter((v) => v.enabled && v.content?.trim());
    if (active.length === 0) return ad.content;
    return active[Math.floor(Math.random() * active.length)].content;
  }
}
