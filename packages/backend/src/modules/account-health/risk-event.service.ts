import * as crypto from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RiskEventEntity } from './risk-event.entity';
import type { RiskRawEvent } from './risk.events';

// risk_event 持久化 + 去重 · §3 doc + 用户 2026-04-20 加固 #1
//   去重锚点: UNIQUE (account_id, code, source_ref)
//   无 source_ref 兜底: md5(code || at_floor_to_minute)
//   INSERT ... ON CONFLICT DO NOTHING (TypeORM upsert with onConflict)
@Injectable()
export class RiskEventService {
  private readonly logger = new Logger(RiskEventService.name);

  constructor(
    @InjectRepository(RiskEventEntity) private readonly repo: Repository<RiskEventEntity>,
  ) {}

  /**
   * 持久化一条 raw event. 返回是否新插入 (false = 已存在去重过).
   */
  async record(event: RiskRawEvent): Promise<{ inserted: boolean }> {
    const at = event.at ?? new Date();
    const sourceRef = event.sourceRef ?? this.fallbackRef(event.code, at);
    try {
      // TypeORM 的 QueryDeepPartialEntity 对 JSONB + nullable 组合类型卡. 这里用 any 绕开.
      const values = {
        accountId: event.accountId,
        code: event.code,
        severity: event.severity,
        source: event.source,
        sourceRef,
        meta: event.meta ?? null,
        at,
      };
      const result = await this.repo
        .createQueryBuilder()
        .insert()
        .into(RiskEventEntity)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .values(values as any)
        .orIgnore() // ON CONFLICT DO NOTHING · UNIQUE(account_id, code, source_ref)
        .execute();
      const inserted = (result.identifiers?.length ?? 0) > 0;
      if (!inserted) {
        this.logger.debug(`risk_event dedupe hit · acc=${event.accountId} code=${event.code} ref=${sourceRef}`);
      }
      return { inserted };
    } catch (err) {
      this.logger.warn(
        `risk_event insert failed · acc=${event.accountId} code=${event.code}: ${err instanceof Error ? err.message : err}`,
      );
      return { inserted: false };
    }
  }

  async findRecent(accountId: number, limit = 20): Promise<RiskEventEntity[]> {
    return this.repo.find({
      where: { accountId },
      order: { at: 'DESC' },
      take: limit,
    });
  }

  /**
   * 滚动窗口查询 · scorer 用. windowDays 外的 event 不计入.
   */
  async findWithinWindow(accountId: number, windowDays: number): Promise<RiskEventEntity[]> {
    const since = new Date(Date.now() - windowDays * 24 * 3600 * 1000);
    return this.repo
      .createQueryBuilder('e')
      .where('e.account_id = :aid', { aid: accountId })
      .andWhere('e.at > :since', { since })
      .orderBy('e.at', 'DESC')
      .getMany();
  }

  /**
   * 趋势折线 · HealthTab 用. 按天分组事件 count (滚动 N 天).
   */
  async trendDaily(accountId: number, days = 7): Promise<Array<{ day: string; count: number }>> {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    const rows = await this.repo
      .createQueryBuilder('e')
      .select(`date_trunc('day', e.at)`, 'day')
      .addSelect('COUNT(*)', 'count')
      .where('e.account_id = :aid', { aid: accountId })
      .andWhere('e.at > :since', { since })
      .groupBy(`date_trunc('day', e.at)`)
      .orderBy('day', 'ASC')
      .getRawMany<{ day: string; count: string }>();
    return rows.map((r) => ({ day: r.day, count: parseInt(r.count, 10) }));
  }

  private fallbackRef(code: string, at: Date): string {
    // 分钟级去重兜底: 同 code 同分钟不重复计
    const minute = Math.floor(at.getTime() / 60000);
    return `auto:${crypto.createHash('md5').update(`${code}|${minute}`).digest('hex').substring(0, 16)}`;
  }
}
