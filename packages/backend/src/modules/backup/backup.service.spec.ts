// M10 · BackupService · A+ missed 补跑 + retention sweep + snapshotSlot whitelist

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BackupService } from './backup.service';
import { todayISO } from './backup-paths';
import type { DataSource } from 'typeorm';
import type { ConfigService } from '@nestjs/config';

function buildFakeDS(lastDailyISO: string | null): DataSource {
  const settingRow = lastDailyISO ? { key: 'backup.last_daily_at', value: lastDailyISO } : null;
  return {
    getRepository: () => ({
      findOne: async () => settingRow,
      createQueryBuilder: () => ({
        getMany: async () => [] as unknown[],
      }),
      find: async () => [] as unknown[],
    }),
    query: async () => [],
  } as unknown as DataSource;
}

function buildCfg(overrides: Record<string, unknown> = {}): ConfigService {
  return {
    get: <T>(key: string, def?: T) => (overrides[key] ?? def) as T,
  } as ConfigService;
}

describe('BackupService', () => {
  const origCwd = process.cwd();
  let tmpCwd: string;

  beforeEach(() => {
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wahubx-bkp-'));
    process.chdir(tmpCwd);
  });

  afterEach(() => {
    process.chdir(origCwd);
    try {
      fs.rmSync(tmpCwd, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('shouldRunMissedBackup · last=null → true', () => {
    const svc = new BackupService(buildFakeDS(null), buildCfg());
    expect((svc as unknown as { shouldRunMissedBackup: (s: string | null) => boolean }).shouldRunMissedBackup(null)).toBe(true);
  });

  it('shouldRunMissedBackup · last > 24h ago → true', () => {
    const svc = new BackupService(buildFakeDS(null), buildCfg());
    const old = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    expect((svc as unknown as { shouldRunMissedBackup: (s: string | null) => boolean }).shouldRunMissedBackup(old)).toBe(true);
  });

  it('shouldRunMissedBackup · last < 24h → false', () => {
    const svc = new BackupService(buildFakeDS(null), buildCfg());
    const recent = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    expect((svc as unknown as { shouldRunMissedBackup: (s: string | null) => boolean }).shouldRunMissedBackup(recent)).toBe(false);
  });

  it('retentionSweep · 删 N 天前的 daily 目录 · 保留近期', () => {
    const svc = new BackupService(buildFakeDS(null), buildCfg({ BACKUP_RETENTION_DAYS: 3 }));
    // 造 5 个日期目录: 今天 / -1 / -2 / -3 / -10
    const now = new Date('2026-04-20T10:00:00');
    const dates = [0, 1, 2, 3, 10].map((d) => {
      const dt = new Date(now);
      dt.setDate(dt.getDate() - d);
      return todayISO(dt);
    });
    for (const d of dates) {
      const dir = path.join(tmpCwd, 'data', 'backups', 'daily', d);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'slot_01.zip'), 'x');
    }
    const removed = svc.retentionSweep(now);
    // retention 3 天 · 保留今天 / -1 / -2 / -3 (4 项); 删 -10 (1 项)
    // 截止 cutoff = now - 3 → 对应日期字符串 · 早于此的删
    expect(removed).toHaveLength(1);
    expect(removed[0]).toBe(dates[4]); // -10
  });

  it('snapshotSlot · 空 slot · skippedReason=empty-slot · 无 zip 文件', async () => {
    const svc = new BackupService(buildFakeDS(null), buildCfg());
    // slot 01 不建任何文件
    const result = await svc.snapshotSlot(1, '2026-04-20');
    expect(result.ok).toBe(true);
    expect(result.skippedReason).toBe('empty-slot');
    expect(result.zipPath).toBeNull();
  });

  it('snapshotSlot · 有 fingerprint 和 wa-session · 成功打 zip', async () => {
    const svc = new BackupService(buildFakeDS(null), buildCfg());
    const slotDir = path.join(tmpCwd, 'data', 'slots', '01');
    fs.mkdirSync(path.join(slotDir, 'wa-session'), { recursive: true });
    fs.writeFileSync(path.join(slotDir, 'fingerprint.json'), '{"model":"test"}');
    fs.writeFileSync(path.join(slotDir, 'wa-session', 'creds.json'), '{"k":1}');
    const result = await svc.snapshotSlot(1, '2026-04-20');
    expect(result.ok).toBe(true);
    expect(result.skippedReason).toBeUndefined();
    expect(result.zipPath).toBeTruthy();
    expect(fs.existsSync(result.zipPath!)).toBe(true);
    expect(result.sizeBytes).toBeGreaterThan(0);
  });
});
