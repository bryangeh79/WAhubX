// M7 Day 5 · Persona Pool Scheduler · 每天 04:00 补充 persona 池 < 20 条
//
// 目的: persona 库常态维持 ≥ 20 条 · 避槽位用完被迫复用
// 触发: 启动一个 setInterval 每小时 tick · 04:00 窗口内执行一次
// 行为: 查 persona.count() · < 20 → PersonaGeneratorService.generate(20 - count)
// Dry-run: DRY_RUN=true 只 log · 不调 AI

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PersonaEntity } from './persona.entity';
import { PersonaGeneratorService } from './persona-generator.service';
import { EthnicityMY } from './persona.types';

const TARGET_POOL_SIZE = 20;
const TICK_INTERVAL_MS = 60 * 60 * 1000; // 1h
const REFILL_HOUR_UTC_PLUS_8 = 4; // 04:00 Asia/Kuala_Lumpur

@Injectable()
export class PersonaPoolScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PersonaPoolScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private lastRefillDayKey = '';

  constructor(
    @InjectRepository(PersonaEntity) private readonly repo: Repository<PersonaEntity>,
    private readonly generator: PersonaGeneratorService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_INTERVAL_MS);
    this.logger.log(`Persona pool scheduler · tick 1h · refill at ${REFILL_HOUR_UTC_PLUS_8}:00 MY`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** 暴露给 UT · 跳过时间窗口检查 · 强制跑一次 */
  async refillNow(ethnicity: EthnicityMY = EthnicityMY.ChineseMalaysian): Promise<{
    before: number;
    after: number;
    saved: number;
  }> {
    const before = await this.repo.count();
    if (before >= TARGET_POOL_SIZE) {
      this.logger.debug(`persona pool 已满 · count=${before} · skip refill`);
      return { before, after: before, saved: 0 };
    }
    const needed = TARGET_POOL_SIZE - before;
    this.logger.log(`persona pool low · count=${before} · generating ${needed}`);
    const report = await this.generator.generate({
      count: needed,
      ethnicity,
    });
    const after = await this.repo.count();
    this.logger.log(
      `persona pool refill · before=${before} after=${after} saved=${report.savedIds.length}`,
    );
    return { before, after, saved: report.savedIds.length };
  }

  async tick(now: Date = new Date()): Promise<void> {
    // 仅当日 04:00-04:59 触发一次
    const myHour = this.getMyHour(now);
    if (myHour !== REFILL_HOUR_UTC_PLUS_8) return;
    const dayKey = this.getMyDayKey(now);
    if (dayKey === this.lastRefillDayKey) return;
    this.lastRefillDayKey = dayKey;
    try {
      await this.refillNow();
    } catch (err) {
      this.logger.error(
        `persona pool refill failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private getMyHour(now: Date): number {
    // MY = UTC+8 · 简化: UTC hour + 8 mod 24
    return (now.getUTCHours() + 8) % 24;
  }

  private getMyDayKey(now: Date): string {
    const myMs = now.getTime() + 8 * 60 * 60 * 1000;
    return new Date(myMs).toISOString().slice(0, 10);
  }
}
