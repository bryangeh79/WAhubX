// M10 · 每日本地快照服务 (§B.11 Layer 1)
//
// 职责:
//   1. onModuleInit: 读 app_setting 'backup.last_daily_at', 若 > 24h 前 / null → A+ missed 补跑
//   2. setInterval 每天 03:00 本地 (默认) 跑一次 · 配置 BACKUP_DAILY_CRON_HOUR 可调
//   3. snapshotAll(): 扫 data/slots/<NN>/ · whitelist 打 zip → backups/daily/<date>/slot_<NN>.zip
//      - whitelist: wa-session/** + fingerprint.json
//      - 排除: media/ (入站日志, 可选 via env BACKUP_INCLUDE_MEDIA=true)
//   4. retentionSweep(): 保留最近 N 天 (默认 7), 删老 daily 目录
//
// 并发: 双重保护 — `busy` flag + mutex per slot (不应同时有两次快照同槽)
// 失败处理: 单槽快照失败不中断批次, 日志 warn; 全批 finally 里记 last_daily_at
//
// 运维接口:
//   runDailyNow() · 手动触发 (Admin UI / debug 用)
//   getSnapshotStatus() · 读 last_daily_at + 扫 daily 目录 · 返概览

import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as archiver from 'archiver';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AccountSlotEntity } from '../slots/account-slot.entity';
import { AppSettingEntity } from '../../common/app-setting.entity';
import { getDataDir, getSlotDir } from '../../common/storage';
import { getDailyDir, listDailyDates, listDailySlotZips, todayISO } from './backup-paths';

export interface SnapshotResult {
  slotIndex: number;
  ok: boolean;
  sizeBytes: number;
  zipPath: string | null;
  error?: string;
  skippedReason?: 'empty-slot' | 'no-session';
}

export interface DailySweepResult {
  date: string;
  slots: SnapshotResult[];
  startedAt: Date;
  finishedAt: Date;
}

const SETTING_LAST_DAILY = 'backup.last_daily_at';

@Injectable()
export class BackupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupService.name);
  private tickTimer: NodeJS.Timeout | null = null;
  private busy = false;

  private readonly dailyHour: number; // 0-23 本地时区
  private readonly retentionDays: number;
  private readonly includeMedia: boolean;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() private readonly config?: ConfigService,
  ) {
    this.dailyHour = this.cfg<number>('BACKUP_DAILY_CRON_HOUR', 3);
    this.retentionDays = this.cfg<number>('BACKUP_RETENTION_DAYS', 7);
    this.includeMedia = this.cfg<string>('BACKUP_INCLUDE_MEDIA', 'false') === 'true';
  }

  async onModuleInit(): Promise<void> {
    // A+ missed 补跑: 上次成功 > 24h / null 立即跑
    const lastISO = await this.readLastDaily();
    const missed = this.shouldRunMissedBackup(lastISO);
    if (missed) {
      this.logger.warn(`missed backup detected (lastDaily=${lastISO ?? 'never'}) · 立即补跑`);
      // 异步跑, 不阻塞 init
      void this.runDailyNow().catch((err) => this.logger.error(`missed backup failed: ${err}`));
    }

    // setInterval 每分钟查一次, 到 hour:00 触发 (比 setTimeout-to-next-day 抗进程重启漂移)
    this.tickTimer = setInterval(() => {
      this.tickCheck().catch((err) => this.logger.error(`daily tick error: ${err}`));
    }, 60_000);
    this.logger.log(
      `BackupService ready · daily=${this.dailyHour.toString().padStart(2, '0')}:00 · retention=${this.retentionDays}d · includeMedia=${this.includeMedia}`,
    );
  }

  onModuleDestroy(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  private shouldRunMissedBackup(lastISO: string | null): boolean {
    if (!lastISO) return true;
    const last = new Date(lastISO);
    if (isNaN(last.getTime())) return true;
    const hoursSince = (Date.now() - last.getTime()) / 3_600_000;
    return hoursSince > 24;
  }

  private async tickCheck(): Promise<void> {
    const now = new Date();
    if (now.getHours() !== this.dailyHour || now.getMinutes() !== 0) return;
    if (this.busy) return;
    // 同日已跑过跳过 (避免 60s 窗口内触发两次)
    const lastISO = await this.readLastDaily();
    if (lastISO) {
      const last = new Date(lastISO);
      if (last.toDateString() === now.toDateString()) return;
    }
    await this.runDailyNow();
  }

  /**
   * 手动 / 定时触发一次 daily 快照 (所有槽 · whitelist) + retention sweep.
   * 返本次结果概览.
   */
  async runDailyNow(): Promise<DailySweepResult> {
    if (this.busy) throw new Error('备份正在执行, 请稍后');
    this.busy = true;
    const startedAt = new Date();
    const date = todayISO(startedAt);
    try {
      // 扫所有已绑定账号的 slot + 空 slot 也备一份 fingerprint.json (便于原机恢复)
      const slots = await this.dataSource
        .getRepository(AccountSlotEntity)
        .createQueryBuilder('s')
        .getMany();

      const results: SnapshotResult[] = [];
      for (const slot of slots) {
        const r = await this.snapshotSlot(slot.slotIndex, date).catch((err) => ({
          slotIndex: slot.slotIndex,
          ok: false,
          sizeBytes: 0,
          zipPath: null,
          error: err instanceof Error ? err.message : String(err),
        } satisfies SnapshotResult));
        results.push(r);
      }

      // 写 last_daily_at (无论成败, 下次 missed 逻辑看的是 "是否跑过"; 失败细节在日志)
      await this.writeLastDaily(startedAt.toISOString());

      // Retention sweep
      const swept = this.retentionSweep();
      if (swept.length > 0) {
        this.logger.log(`retention sweep 删 ${swept.length} 天: ${swept.join(', ')}`);
      }

      const okCount = results.filter((r) => r.ok).length;
      const skippedCount = results.filter((r) => r.skippedReason).length;
      const failCount = results.filter((r) => !r.ok && !r.skippedReason).length;
      this.logger.log(
        `daily snapshot ${date} · ok=${okCount} skipped=${skippedCount} fail=${failCount}`,
      );
      return { date, slots: results, startedAt, finishedAt: new Date() };
    } finally {
      this.busy = false;
    }
  }

  /**
   * 单 slot zip 打包. slotIndex 1-based (同 slot_index 列).
   */
  async snapshotSlot(slotIndex: number, dateISO: string = todayISO()): Promise<SnapshotResult> {
    const slotDir = getSlotDir(slotIndex);
    const dailyDir = getDailyDir(dateISO);
    const zipName = `slot_${String(slotIndex).padStart(2, '0')}.zip`;
    const zipPath = path.join(dailyDir, zipName);

    // 若今日已存在, 覆写 (幂等)
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

    // whitelist 检查
    const fingerprintFile = path.join(slotDir, 'fingerprint.json');
    const waSessionDir = path.join(slotDir, 'wa-session');
    const hasFingerprint = fs.existsSync(fingerprintFile);
    const hasSession = fs.existsSync(waSessionDir) && fs.readdirSync(waSessionDir).length > 0;

    if (!hasFingerprint && !hasSession) {
      return { slotIndex, ok: true, sizeBytes: 0, zipPath: null, skippedReason: 'empty-slot' };
    }

    return await new Promise<SnapshotResult>((resolve) => {
      const output = fs.createWriteStream(zipPath);
      const archive = archiver.create('zip', { zlib: { level: 6 } });

      output.on('close', () => {
        resolve({ slotIndex, ok: true, sizeBytes: archive.pointer(), zipPath });
      });
      archive.on('warning', (err) => this.logger.warn(`slot ${slotIndex} archive warning: ${err}`));
      archive.on('error', (err) => {
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        resolve({
          slotIndex,
          ok: false,
          sizeBytes: 0,
          zipPath: null,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      archive.pipe(output);
      if (hasFingerprint) archive.file(fingerprintFile, { name: 'fingerprint.json' });
      if (hasSession) archive.directory(waSessionDir, 'wa-session');
      if (this.includeMedia) {
        const mediaDir = path.join(slotDir, 'media');
        if (fs.existsSync(mediaDir)) archive.directory(mediaDir, 'media');
      }
      void archive.finalize();
    });
  }

  /**
   * 删 retentionDays 之外的 daily 目录 · 返被删日期列表.
   */
  retentionSweep(now: Date = new Date()): string[] {
    const dates = listDailyDates();
    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - this.retentionDays);
    const cutoffISO = todayISO(cutoff);
    const removed: string[] = [];
    for (const d of dates) {
      if (d < cutoffISO) {
        const dir = path.join(getDataDir(), 'backups', 'daily', d);
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          removed.push(d);
        } catch (err) {
          this.logger.warn(`retention sweep 删 ${d} 失败: ${err}`);
        }
      }
    }
    return removed;
  }

  /**
   * UI 用 · 概览视图 (不 decrypt · 不读 zip 内容)
   */
  async getSnapshotStatus(): Promise<{
    lastDailyAt: string | null;
    retentionDays: number;
    dailyHour: number;
    dates: Array<{ date: string; slotCount: number; totalBytes: number }>;
  }> {
    const lastDailyAt = await this.readLastDaily();
    const dates = listDailyDates().map((d) => {
      const slots = listDailySlotZips(d);
      return {
        date: d,
        slotCount: slots.length,
        totalBytes: slots.reduce((sum, s) => sum + s.sizeBytes, 0),
      };
    });
    return {
      lastDailyAt,
      retentionDays: this.retentionDays,
      dailyHour: this.dailyHour,
      dates,
    };
  }

  private async readLastDaily(): Promise<string | null> {
    const row = await this.dataSource
      .getRepository(AppSettingEntity)
      .findOne({ where: { key: SETTING_LAST_DAILY } });
    if (!row || row.value === 'null' || !row.value) return null;
    return row.value;
  }

  private async writeLastDaily(iso: string): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO "app_setting" ("key", "value", "updated_at") VALUES ($1, $2, NOW())
       ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = NOW()`,
      [SETTING_LAST_DAILY, iso],
    );
  }

  private cfg<T>(key: string, def: T): T {
    if (!this.config) return def;
    const v = this.config.get<T>(key, def);
    // 数值 env 强制转 number
    if (typeof def === 'number' && typeof v === 'string') return Number(v) as unknown as T;
    return v;
  }
}
