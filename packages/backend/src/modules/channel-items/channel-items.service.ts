import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, IsNull, Repository } from 'typeorm';
import { ChannelItemEntity } from './channel-item.entity';
import type { CreateChannelItemDto } from './dto/create-channel-item.dto';

@Injectable()
export class ChannelItemsService {
  private readonly logger = new Logger(ChannelItemsService.name);

  constructor(
    @InjectRepository(ChannelItemEntity)
    private readonly repo: Repository<ChannelItemEntity>,
  ) {}

  /**
   * 列出: tenant_id=当前租户 + global=true (租户自录 + 种子)
   * 平台超管 (tenantId=null) 看全部
   */
  async listForTenant(tenantId: number | null, filters: { tag?: string; onlyGlobal?: boolean } = {}) {
    const qb = this.repo
      .createQueryBuilder('c')
      .where('c.enabled = true')
      .orderBy('c.global', 'DESC')
      .addOrderBy('c.created_at', 'ASC');

    if (tenantId !== null && !filters.onlyGlobal) {
      qb.andWhere(new Brackets((q) => {
        q.where('c.global = true').orWhere('c.tenant_id = :tid', { tid: tenantId });
      }));
    } else if (filters.onlyGlobal) {
      qb.andWhere('c.global = true');
    }

    if (filters.tag) {
      qb.andWhere(':tag = ANY(c.tags)', { tag: filters.tag });
    }

    return qb.getMany();
  }

  async create(tenantId: number | null, dto: CreateChannelItemDto, asGlobal = false): Promise<ChannelItemEntity> {
    if (asGlobal && tenantId !== null) {
      throw new ForbiddenException('只有平台超管可以创建 global 种子');
    }
    if (!dto.inviteCode && !dto.jid) {
      throw new BadRequestException('inviteCode 或 jid 必填一个');
    }
    const item = this.repo.create({
      tenantId: asGlobal ? null : tenantId,
      global: asGlobal,
      name: dto.name,
      inviteCode: dto.inviteCode ?? null,
      jid: dto.jid ?? null,
      description: dto.description ?? null,
      tags: dto.tags ?? [],
      subscribers: dto.subscribers ?? null,
    });
    return this.repo.save(item);
  }

  async update(id: number, tenantId: number | null, patch: Partial<CreateChannelItemDto>) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`频道 ${id} 不存在`);
    if (item.global && tenantId !== null) {
      throw new ForbiddenException('global 种子只能平台超管改');
    }
    if (!item.global && item.tenantId !== tenantId && tenantId !== null) {
      throw new ForbiddenException('无权改他租户的频道');
    }
    Object.assign(item, patch);
    return this.repo.save(item);
  }

  async remove(id: number, tenantId: number | null) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`频道 ${id} 不存在`);
    if (item.global && tenantId !== null) {
      throw new ForbiddenException('global 种子只能平台超管删');
    }
    if (!item.global && item.tenantId !== tenantId && tenantId !== null) {
      throw new ForbiddenException('无权删他租户的频道');
    }
    await this.repo.remove(item);
  }

  /**
   * 随机挑 N 个 · follow_channel 任务 "按 tag 随机" 或 "完全随机" 模式用
   */
  async pickRandom(
    tenantId: number | null,
    opts: { tags?: string[]; count?: number; onlyGlobal?: boolean } = {},
  ): Promise<ChannelItemEntity[]> {
    const count = Math.min(Math.max(opts.count ?? 5, 1), 50);
    const qb = this.repo
      .createQueryBuilder('c')
      .where('c.enabled = true')
      .andWhere('c.invite_code IS NOT NULL');

    if (tenantId !== null && !opts.onlyGlobal) {
      qb.andWhere(new Brackets((q) => {
        q.where('c.global = true').orWhere('c.tenant_id = :tid', { tid: tenantId });
      }));
    } else if (opts.onlyGlobal) {
      qb.andWhere('c.global = true');
    }

    if (opts.tags && opts.tags.length > 0) {
      qb.andWhere('c.tags && :tags::text[]', { tags: opts.tags });
    }

    qb.orderBy('RANDOM()').limit(count);
    return qb.getMany();
  }

  /**
   * CSV 批量导入 · header: name,invite_code,tags,description
   * tags 用 | 分隔
   */
  async bulkImport(
    tenantId: number | null,
    csv: string,
    defaultTag?: string,
    asGlobal = false,
  ): Promise<{ imported: number; skipped: number; errors: string[] }> {
    if (asGlobal && tenantId !== null) {
      throw new ForbiddenException('只有平台超管可以批量导入 global 种子');
    }
    const lines = csv.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
    if (lines.length < 2) throw new BadRequestException('CSV 至少需 1 条数据 (+ 1 行表头)');
    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const idx = (k: string) => header.indexOf(k);
    const nameI = idx('name');
    const inviteI = idx('invite_code');
    const tagsI = idx('tags');
    const descI = idx('description');
    if (nameI < 0 || inviteI < 0) {
      throw new BadRequestException('CSV 表头必须含 name,invite_code');
    }
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim());
      const name = cols[nameI];
      const invite = cols[inviteI];
      if (!name) {
        skipped++;
        continue;
      }
      const tags = (cols[tagsI] ?? '').split('|').map((t) => t.trim()).filter(Boolean);
      if (defaultTag && !tags.includes(defaultTag)) tags.push(defaultTag);
      const description = descI >= 0 ? cols[descI] : undefined;
      // 幂等: 如已存在同 invite_code (同 tenant 范围或 global) · 跳过
      if (invite) {
        const exist = await this.repo.findOne({
          where: asGlobal
            ? { global: true, inviteCode: invite }
            : { tenantId: tenantId ?? IsNull() as unknown as number, inviteCode: invite },
        });
        if (exist) {
          skipped++;
          continue;
        }
      }
      try {
        await this.repo.save(
          this.repo.create({
            tenantId: asGlobal ? null : tenantId,
            global: asGlobal,
            name,
            inviteCode: invite || null,
            tags,
            description: description ?? null,
          }),
        );
        imported++;
      } catch (err: unknown) {
        errors.push(`line ${i + 1}: ${(err as Error).message}`);
      }
    }
    this.logger.log(`bulk import (global=${asGlobal}): ${imported} imported, ${skipped} skipped`);
    return { imported, skipped, errors };
  }

  /** 列出所有 tag · 去重 · 带计数 (素材库过滤用) */
  async listTags(tenantId: number | null): Promise<Array<{ tag: string; count: number }>> {
    const qb = this.repo
      .createQueryBuilder('c')
      .select('UNNEST(c.tags)', 'tag')
      .addSelect('COUNT(*)', 'count')
      .where('c.enabled = true')
      .groupBy('tag')
      .orderBy('count', 'DESC');
    if (tenantId !== null) {
      qb.andWhere(new Brackets((q) => {
        q.where('c.global = true').orWhere('c.tenant_id = :tid', { tid: tenantId });
      }));
    }
    const rows: Array<{ tag: string; count: string }> = await qb.getRawMany();
    return rows.map((r) => ({ tag: r.tag, count: parseInt(r.count, 10) }));
  }
}
