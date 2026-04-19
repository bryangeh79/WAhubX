import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ScriptPackEntity } from './script-pack.entity';
import { ScriptEntity } from './script.entity';

// .wspack / .json 包格式 (技术交接文档 § 3.5, § 4.6)
// 顶层字段对齐 scripts/scripts_pack_my_zh_v1.json
export interface PackJson {
  pack_id: string;
  pack_name?: string;
  name?: string; // 有的包叫 name 有的叫 pack_name, 兼容
  version: string;
  language: string;
  country: string[];
  author?: string;
  description?: string;
  asset_pools_required?: string[];
  signature?: string;
  scripts: PackScriptJson[];
}

export interface PackScriptJson {
  id: string;
  name: string;
  category: string;
  total_turns: number;
  min_warmup_stage?: number;
  ai_rewrite?: boolean;
  // 剩余字段 (sessions/turns/safety 等) 进 content 透传
  [key: string]: unknown;
}

// 增量 batch 文件格式 (scripts_pack_my_zh_v1_batch2.json 等).
// 不独立成包, 引用已有 pack 追加 scripts.
export interface PackBatchJson {
  pack_ref: string;
  batch_id?: string;
  scripts_count?: number;
  description?: string;
  scripts: PackScriptJson[];
}

@Injectable()
export class PackLoaderService {
  private readonly logger = new Logger(PackLoaderService.name);

  constructor(
    @InjectRepository(ScriptPackEntity) private readonly packRepo: Repository<ScriptPackEntity>,
    @InjectRepository(ScriptEntity) private readonly scriptRepo: Repository<ScriptEntity>,
  ) {}

  /**
   * 从磁盘目录扫描 *.json, 逐个 import. 幂等: pack_id 存在则更新 version / scripts 增量.
   * 默认入口 scripts/ 目录 — 开发/初装时灌数据用.
   */
  async importFromDirectory(dir: string): Promise<{ imported: string[]; skipped: string[] }> {
    if (!fs.existsSync(dir)) throw new NotFoundException(`目录 ${dir} 不存在`);
    const imported: string[] = [];
    const skipped: string[] = [];

    // 两遍: 第一遍装主包 (有 pack_id), 第二遍装增量 batch (有 pack_ref).
    // 保证主包先落盘, 增量才能 attach.
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const mainFiles: string[] = [];
    const batchFiles: string[] = [];
    for (const f of files) {
      try {
        const json = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as Record<string, unknown>;
        if (typeof json.pack_id === 'string') mainFiles.push(f);
        else if (typeof json.pack_ref === 'string') batchFiles.push(f);
        else skipped.push(f);
      } catch {
        skipped.push(f);
      }
    }

    for (const f of mainFiles) {
      try {
        const json = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as PackJson;
        await this.importJson(json);
        imported.push(f);
      } catch (err) {
        this.logger.warn(`skip main ${f}: ${err instanceof Error ? err.message : err}`);
        skipped.push(f);
      }
    }
    for (const f of batchFiles) {
      try {
        const json = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as PackBatchJson;
        await this.importBatchJson(json);
        imported.push(f);
      } catch (err) {
        this.logger.warn(`skip batch ${f}: ${err instanceof Error ? err.message : err}`);
        skipped.push(f);
      }
    }
    return { imported, skipped };
  }

  /**
   * batch 文件: 通过 pack_ref 找已存在的主包, scripts 增量 upsert.
   */
  async importBatchJson(json: PackBatchJson): Promise<ScriptPackEntity> {
    if (!json.pack_ref) throw new BadRequestException('batch 文件必须有 pack_ref');
    const pack = await this.packRepo.findOne({ where: { packId: json.pack_ref } });
    if (!pack) throw new NotFoundException(`找不到 pack_ref=${json.pack_ref}, 请先导入主包`);
    if (!Array.isArray(json.scripts)) throw new BadRequestException(`batch ${json.batch_id ?? ''} 缺 scripts 数组`);

    let upserted = 0;
    for (const s of json.scripts) {
      this.validateScript(s);
      const existingScript = await this.scriptRepo.findOne({
        where: { packId: pack.id, scriptId: s.id },
      });
      const { id: _, name: __, category: ___, total_turns: ____, min_warmup_stage: _____, ai_rewrite: ______, ...contentRest } = s;
      if (existingScript) {
        existingScript.name = s.name;
        existingScript.category = s.category;
        existingScript.totalTurns = s.total_turns;
        existingScript.minWarmupStage = s.min_warmup_stage ?? 0;
        existingScript.aiRewrite = s.ai_rewrite ?? true;
        existingScript.content = contentRest as Record<string, unknown>;
        await this.scriptRepo.save(existingScript);
      } else {
        await this.scriptRepo.save(
          this.scriptRepo.create({
            packId: pack.id,
            scriptId: s.id,
            name: s.name,
            category: s.category,
            totalTurns: s.total_turns,
            minWarmupStage: s.min_warmup_stage ?? 0,
            aiRewrite: s.ai_rewrite ?? true,
            content: contentRest as Record<string, unknown>,
          }),
        );
      }
      upserted++;
    }
    this.logger.log(`batch ${json.batch_id ?? '(unnamed)'} upserted ${upserted} scripts into ${pack.packId}`);
    return pack;
  }

  /**
   * 导入一个 pack JSON. 幂等:
   *   - pack_id 不存在 → 插 pack + 所有 scripts
   *   - pack_id 存在 → 更新 pack 字段, scripts 按 (pack_id, script_id) 做 upsert
   */
  async importJson(json: PackJson): Promise<ScriptPackEntity> {
    this.validatePack(json);

    const existing = await this.packRepo.findOne({ where: { packId: json.pack_id } });
    let pack: ScriptPackEntity;
    if (existing) {
      existing.name = json.pack_name ?? json.name ?? existing.name;
      existing.version = json.version;
      existing.language = json.language;
      existing.country = json.country;
      existing.author = json.author ?? null;
      existing.description = json.description ?? null;
      existing.assetPoolsRequired = json.asset_pools_required ?? [];
      existing.signature = json.signature ?? null;
      pack = await this.packRepo.save(existing);
      this.logger.log(`Updated pack ${json.pack_id} → v${json.version}`);
    } else {
      pack = await this.packRepo.save(
        this.packRepo.create({
          packId: json.pack_id,
          name: json.pack_name ?? json.name ?? json.pack_id,
          version: json.version,
          language: json.language,
          country: json.country,
          author: json.author ?? null,
          description: json.description ?? null,
          assetPoolsRequired: json.asset_pools_required ?? [],
          signature: json.signature ?? null,
          enabled: true,
        }),
      );
      this.logger.log(`Installed pack ${json.pack_id} v${json.version}`);
    }

    // 逐个 upsert script (按 pack_id + script_id 唯一)
    let upserted = 0;
    for (const s of json.scripts) {
      this.validateScript(s);
      const existingScript = await this.scriptRepo.findOne({
        where: { packId: pack.id, scriptId: s.id },
      });
      // content 去掉已被结构化字段后存 (避免重复)
      const { id: _, name: __, category: ___, total_turns: ____, min_warmup_stage: _____, ai_rewrite: ______, ...contentRest } = s;
      if (existingScript) {
        existingScript.name = s.name;
        existingScript.category = s.category;
        existingScript.totalTurns = s.total_turns;
        existingScript.minWarmupStage = s.min_warmup_stage ?? 0;
        existingScript.aiRewrite = s.ai_rewrite ?? true;
        existingScript.content = contentRest as Record<string, unknown>;
        await this.scriptRepo.save(existingScript);
      } else {
        await this.scriptRepo.save(
          this.scriptRepo.create({
            packId: pack.id,
            scriptId: s.id,
            name: s.name,
            category: s.category,
            totalTurns: s.total_turns,
            minWarmupStage: s.min_warmup_stage ?? 0,
            aiRewrite: s.ai_rewrite ?? true,
            content: contentRest as Record<string, unknown>,
          }),
        );
      }
      upserted++;
    }
    this.logger.log(`Upserted ${upserted} scripts into pack ${pack.packId}`);
    return pack;
  }

  async listPacks(): Promise<ScriptPackEntity[]> {
    return this.packRepo.find({ order: { packId: 'ASC' } });
  }

  async listScripts(packId: number): Promise<ScriptEntity[]> {
    return this.scriptRepo.find({ where: { packId }, order: { scriptId: 'ASC' } });
  }

  async findScript(scriptDbId: number): Promise<ScriptEntity> {
    const s = await this.scriptRepo.findOne({ where: { id: scriptDbId }, relations: ['pack'] });
    if (!s) throw new NotFoundException(`剧本 ${scriptDbId} 不存在`);
    return s;
  }

  async togglePack(packId: number, enabled: boolean): Promise<ScriptPackEntity> {
    const pack = await this.packRepo.findOne({ where: { id: packId } });
    if (!pack) throw new NotFoundException(`剧本包 ${packId} 不存在`);
    pack.enabled = enabled;
    return this.packRepo.save(pack);
  }

  async removePack(packId: number): Promise<void> {
    const pack = await this.packRepo.findOne({ where: { id: packId } });
    if (!pack) throw new NotFoundException(`剧本包 ${packId} 不存在`);
    await this.packRepo.remove(pack); // CASCADE 带走 scripts
  }

  // ── 校验 ─────────────────────────────────────────────
  private validatePack(json: PackJson): void {
    if (!json.pack_id || typeof json.pack_id !== 'string') {
      throw new BadRequestException('pack_id 必需且为字符串');
    }
    if (!json.version) throw new BadRequestException('version 必需');
    if (!json.language) throw new BadRequestException('language 必需');
    if (!Array.isArray(json.country) || json.country.length === 0) {
      throw new BadRequestException('country 必需 (非空字符串数组)');
    }
    if (!Array.isArray(json.scripts)) {
      throw new BadRequestException('scripts 必需 (数组)');
    }
    const ids = new Set<string>();
    for (const s of json.scripts) {
      if (ids.has(s.id)) {
        throw new ConflictException(`包内剧本 id 重复: ${s.id}`);
      }
      ids.add(s.id);
    }
  }

  private validateScript(s: PackScriptJson): void {
    if (!s.id || !s.name || !s.category) {
      throw new BadRequestException(`script 缺字段: id=${s.id} name=${s.name} category=${s.category}`);
    }
    if (!Number.isInteger(s.total_turns) || s.total_turns <= 0) {
      throw new BadRequestException(`script ${s.id} total_turns 必须是正整数`);
    }
    if (!Array.isArray(s.sessions)) {
      throw new BadRequestException(`script ${s.id} 缺 sessions 数组`);
    }
  }
}
