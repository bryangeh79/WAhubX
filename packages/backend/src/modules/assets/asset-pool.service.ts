// 2026-04-22 · 素材池扫描 / 随机挑 / 列表 · 给 send_* executor + 前端 UI 用
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AssetEntity, AssetKind, AssetSource } from '../scripts/asset.entity';
import { getDataDir } from '../../common/storage';

@Injectable()
export class AssetPoolService {
  private readonly logger = new Logger(AssetPoolService.name);

  constructor(
    @InjectRepository(AssetEntity)
    private readonly assetRepo: Repository<AssetEntity>,
  ) {}

  /** 扫 data/assets/<kind>/<pool>/* · 新增条目入 DB · 幂等 */
  async reindexAll(): Promise<{ scanned: number; added: number; skipped: number }> {
    const root = path.join(getDataDir(), 'assets');
    let scanned = 0, added = 0, skipped = 0;
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
      return { scanned: 0, added: 0, skipped: 0 };
    }
    // kind 目录: voices / images / videos / files / stickers
    const kindMap: Record<string, AssetKind> = {
      voices: AssetKind.Voice,
      images: AssetKind.Image,
      videos: AssetKind.Video,
      files: AssetKind.File,
      stickers: AssetKind.Sticker,
    };
    for (const [dirName, kind] of Object.entries(kindMap)) {
      const kindRoot = path.join(root, dirName);
      if (!fs.existsSync(kindRoot)) continue;
      for (const poolName of fs.readdirSync(kindRoot)) {
        if (poolName.startsWith('_')) continue; // skip _builtin 由单独逻辑管
        const poolDir = path.join(kindRoot, poolName);
        if (!fs.statSync(poolDir).isDirectory()) continue;
        for (const filename of fs.readdirSync(poolDir)) {
          const filePath = path.join(poolDir, filename);
          if (!fs.statSync(filePath).isFile()) continue;
          scanned++;
          const relPath = ['assets', dirName, poolName, filename].join('/');
          const exist = await this.assetRepo.findOne({ where: { filePath: relPath } });
          if (exist) {
            skipped++;
            continue;
          }
          await this.assetRepo.save(
            this.assetRepo.create({
              poolName,
              kind,
              filePath: relPath,
              meta: { filename, size: fs.statSync(filePath).size },
              source: AssetSource.Pack,
            }),
          );
          added++;
        }
      }
    }
    this.logger.log(`reindex · 扫 ${scanned} · 新增 ${added} · 跳过 ${skipped}`);
    return { scanned, added, skipped };
  }

  /** 列所有池 · 按 kind 分组 · 带每池 count */
  async listPools(kind?: AssetKind): Promise<Array<{ kind: string; pool: string; count: number }>> {
    const qb = this.assetRepo
      .createQueryBuilder('a')
      .select('a.kind', 'kind')
      .addSelect('a.pool_name', 'pool')
      .addSelect('COUNT(*)::int', 'count')
      .groupBy('a.kind')
      .addGroupBy('a.pool_name')
      .orderBy('a.kind')
      .addOrderBy('a.pool_name');
    if (kind) qb.where('a.kind = :kind', { kind });
    return qb.getRawMany();
  }

  /** 列某池的所有 asset */
  async listInPool(kind: AssetKind, poolName: string): Promise<AssetEntity[]> {
    return this.assetRepo.find({
      where: { kind, poolName },
      order: { id: 'ASC' },
    });
  }

  /** 随机挑 N 个 · 可按 pool 过滤 · 排除指定 id */
  async pickRandom(
    kind: AssetKind,
    opts: { pool?: string; count?: number; excludeIds?: number[] } = {},
  ): Promise<AssetEntity[]> {
    const qb = this.assetRepo
      .createQueryBuilder('a')
      .where('a.kind = :kind', { kind });
    if (opts.pool) qb.andWhere('a.pool_name = :pool', { pool: opts.pool });
    if (opts.excludeIds && opts.excludeIds.length > 0) {
      qb.andWhere('a.id NOT IN (:...ids)', { ids: opts.excludeIds });
    }
    qb.orderBy('RANDOM()').limit(opts.count ?? 1);
    return qb.getMany();
  }

  async removeAsset(id: number): Promise<void> {
    const asset = await this.assetRepo.findOne({ where: { id } });
    if (!asset) return;
    const absPath = path.join(getDataDir(), asset.filePath.replace(/^\//, ''));
    try {
      if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
    } catch (err) {
      this.logger.warn(`删文件失败 ${absPath}: ${err}`);
    }
    await this.assetRepo.delete(id);
  }

  /** 获取绝对文件路径 (executor 用) */
  getAbsolutePath(asset: AssetEntity): string {
    return path.join(getDataDir(), asset.filePath);
  }
}
