// M10 · 备份路径辅助 · 文件系统布局一处定义 · 所有服务共用
//
// 目录结构 (WAHUBX_DATA_DIR 或 cwd/data):
//   data/
//   ├─ config/master-key-fingerprint.txt       (M10 · MachineBoundMasterKey 派生源)
//   ├─ slots/<NN>/wa-session/                (Baileys creds) ← backup 白名单
//   ├─ slots/<NN>/fingerprint.json           (槽指纹) ← backup 白名单
//   ├─ slots/<NN>/media/                     (入站媒体) ← 默认**不**备份
//   └─ backups/
//       ├─ daily/<YYYY-MM-DD>/slot_<NN>.zip  (每日槽级 zip · 明文 · 7 日 retention)
//       ├─ manual/<ts>.wab                   (用户手动导出)
//       ├─ pre-migration/<ts>.wab            (E1 · MasterKey 迁移前)
//       └─ pre-import/<ts>.wab               (F+ · 导入 .wab 前当前状态)

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDataDir } from '../../common/storage';

export function getBackupsRoot(): string {
  const dir = path.join(getDataDir(), 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getDailyDir(dateISO: string): string {
  // dateISO = 'YYYY-MM-DD'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) {
    throw new Error(`getDailyDir · 日期格式非法: ${dateISO}`);
  }
  const dir = path.join(getBackupsRoot(), 'daily', dateISO);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getManualDir(): string {
  const dir = path.join(getBackupsRoot(), 'manual');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getPreMigrationDir(): string {
  const dir = path.join(getBackupsRoot(), 'pre-migration');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function getPreImportDir(): string {
  const dir = path.join(getBackupsRoot(), 'pre-import');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// M11 Day 4 · .wupd apply 前自动快照
export function getPreUpdateDir(): string {
  const dir = path.join(getBackupsRoot(), 'pre-update');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 日期 ISO 'YYYY-MM-DD' 本地时区 */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 列所有 daily 快照目录 (已存在的日期) */
export function listDailyDates(): string[] {
  const root = path.join(getBackupsRoot(), 'daily');
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root)
    .filter((n) => /^\d{4}-\d{2}-\d{2}$/.test(n))
    .sort();
}

/** 列某日期目录下所有 slot_NN.zip */
export function listDailySlotZips(dateISO: string): Array<{ slotIndex: number; filePath: string; sizeBytes: number }> {
  const dir = path.join(getBackupsRoot(), 'daily', dateISO);
  if (!fs.existsSync(dir)) return [];
  const entries: Array<{ slotIndex: number; filePath: string; sizeBytes: number }> = [];
  for (const file of fs.readdirSync(dir)) {
    const m = /^slot_(\d{2})\.zip$/.exec(file);
    if (!m) continue;
    const abs = path.join(dir, file);
    const stat = fs.statSync(abs);
    entries.push({ slotIndex: parseInt(m[1], 10), filePath: abs, sizeBytes: stat.size });
  }
  return entries.sort((a, b) => a.slotIndex - b.slotIndex);
}
