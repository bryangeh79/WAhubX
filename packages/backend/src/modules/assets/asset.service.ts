// M7 Day 4 · AssetService · CRUD + 池抽签
//
// 职责:
//   - create: 落盘 buffer → data/assets/<kind>/<pool>/<filename> · insert DB
//   - pickRandom: 按 (kind, poolName, personaId?) 找候选 · 随机 1 条
//   - countByPersonaAndKind: 配额显示用 (100 图 + 50 语音 / persona)
//   - delete: DB + 磁盘文件 · 用户手动删或过期清理

import * as fs from 'node:fs';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssetEntity, AssetKind, AssetSource } from '../scripts/asset.entity';
import {
  getAssetFilePath,
  toAssetRelativePath,
  getDataDir,
} from '../../common/storage';
import * as path from 'node:path';

export interface AssetCreateInput {
  kind: AssetKind;
  poolName: string;
  filename: string;
  buffer: Buffer;
  source: AssetSource;
  personaId?: string | null;
  meta?: Record<string, unknown>;
  generatedForSlot?: number | null;
}

@Injectable()
export class AssetService {
  constructor(
    @InjectRepository(AssetEntity) private readonly repo: Repository<AssetEntity>,
  ) {}

  async create(input: AssetCreateInput): Promise<AssetEntity> {
    const absPath = getAssetFilePath(input.kind, input.poolName, input.filename);
    fs.writeFileSync(absPath, input.buffer);
    const relPath = toAssetRelativePath(input.kind, input.poolName, input.filename);
    const entity = this.repo.create({
      kind: input.kind,
      poolName: input.poolName,
      filePath: relPath,
      source: input.source,
      personaId: input.personaId ?? null,
      meta: input.meta ?? null,
      generatedForSlot: input.generatedForSlot ?? null,
    });
    return this.repo.save(entity);
  }

  /** 抽签 · 按 poolName + kind · 可选 personaId (优先专属 · 无则通用池) */
  async pickRandom(
    kind: AssetKind,
    poolName: string,
    personaId?: string,
  ): Promise<AssetEntity | null> {
    // 先找 persona 专属
    if (personaId) {
      const personaOwned = await this.repo.find({
        where: { kind, poolName, personaId },
        take: 20,
      });
      if (personaOwned.length > 0) {
        return personaOwned[Math.floor(Math.random() * personaOwned.length)];
      }
    }
    // fallback 通用池 (personaId IS NULL)
    const shared = await this.repo
      .createQueryBuilder('a')
      .where('a.kind = :kind AND a.pool_name = :pool AND a.persona_id IS NULL', {
        kind,
        pool: poolName,
      })
      .limit(20)
      .getMany();
    if (shared.length === 0) return null;
    return shared[Math.floor(Math.random() * shared.length)];
  }

  async countByPersonaAndKind(personaId: string, kind: AssetKind): Promise<number> {
    return this.repo.count({ where: { personaId, kind } });
  }

  async delete(id: number): Promise<boolean> {
    const asset = await this.repo.findOne({ where: { id } });
    if (!asset) return false;
    // 磁盘文件
    try {
      const abs = path.join(getDataDir(), asset.filePath);
      if (fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch {
      // 文件不在就算了 · DB 为权威
    }
    await this.repo.remove(asset);
    return true;
  }
}
