// M7 Day 4 · PersonaGeneratorService
//
// 流程:
//   1. buildPersonaGenPrompt(count, ethnicity) → AI provider rewrite/generate
//   2. parse JSON array · 每条 PersonaV1Schema.safeParse
//   3. detectMainlandLeakage(每条) · 有 leakage 丢弃
//   4. dedupe by content_hash (computePersonaHash)
//   5. 保存 · 返合格 persona 列表
//
// 失败策略:
//   - AI 失败 · 返 空列表 + 日志警告 (不炸 · 上层 retry)
//   - 单条解析失败 · 跳过 · 记 warn
//   - leakage · 跳过 · 不进库

import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PersonaEntity } from './persona.entity';
import {
  EthnicityMY,
  PersonaV1Schema,
  computePersonaHash,
  type PersonaV1,
} from './persona.types';
import {
  buildPersonaGenPrompt,
  detectMainlandLeakage,
} from './prompts/persona-zh-my';
import { AiTextService } from '../ai/ai-text.service';

export interface PersonaGenParams {
  count: number;
  ethnicity: EthnicityMY;
  style_hint?: string;
  gender_ratio_female?: number;
}

export interface PersonaGenReport {
  requested: number;
  parsed: number;
  rejectedLeakage: number;
  rejectedSchema: number;
  savedIds: string[];
  aiProviderUsed: string | null;
}

@Injectable()
export class PersonaGeneratorService {
  private readonly logger = new Logger(PersonaGeneratorService.name);

  constructor(
    @InjectRepository(PersonaEntity) private readonly repo: Repository<PersonaEntity>,
    @Optional() private readonly aiText?: AiTextService,
  ) {}

  async generate(params: PersonaGenParams): Promise<PersonaGenReport> {
    const report: PersonaGenReport = {
      requested: params.count,
      parsed: 0,
      rejectedLeakage: 0,
      rejectedSchema: 0,
      savedIds: [],
      aiProviderUsed: null,
    };

    if (!this.aiText) {
      this.logger.warn('aiText service 未注入 · 跳过 persona generation');
      return report;
    }

    const prompt = buildPersonaGenPrompt(params); // throws if ethnicity not supported
    const aiResult = await this.aiText.rewrite(
      { originalText: prompt, personaHint: undefined },
      true,
    );
    if (!aiResult || !aiResult.ok) {
      this.logger.warn(`AI persona gen fail · err=${aiResult?.error ?? 'null'}`);
      return report;
    }
    report.aiProviderUsed = aiResult.providerUsed;

    // parse JSON array (tolerant · 剥 markdown fence)
    const raw = stripMarkdownFence(aiResult.text);
    let candidates: unknown[];
    try {
      const parsed = JSON.parse(raw);
      candidates = Array.isArray(parsed) ? parsed : [parsed];
    } catch (err) {
      this.logger.warn(`AI 返非 JSON · head 200: ${raw.slice(0, 200)}`);
      return report;
    }

    // validate + leakage + dedupe + save
    const seenHashes = new Set<string>();
    for (const raw of candidates) {
      const schemaResult = PersonaV1Schema.safeParse(raw);
      if (!schemaResult.success) {
        report.rejectedSchema++;
        continue;
      }
      const persona = schemaResult.data as PersonaV1;
      const leakage = detectMainlandLeakage(persona);
      if (leakage.length > 0) {
        report.rejectedLeakage++;
        continue;
      }
      report.parsed++;
      const contentHash = computePersonaHash(persona);
      if (seenHashes.has(contentHash)) continue;
      seenHashes.add(contentHash);

      await this.repo.save(
        this.repo.create({
          personaId: persona.persona_id,
          displayName: persona.display_name,
          waNickname: persona.wa_nickname,
          ethnicity: persona.ethnicity,
          country: persona.country,
          content: persona,
          contentHash,
          avatarAssetId: null,
          usedBySlotIds: [],
          source: 'ai_generated',
        }),
      );
      report.savedIds.push(persona.persona_id);
    }

    this.logger.log(
      `persona gen · requested=${report.requested} parsed=${report.parsed} saved=${report.savedIds.length} · leakage_rej=${report.rejectedLeakage} schema_rej=${report.rejectedSchema}`,
    );
    return report;
  }
}

function stripMarkdownFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}
