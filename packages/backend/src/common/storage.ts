import * as fs from 'node:fs';
import * as path from 'node:path';

// 与 machine-id.util 同源, 统一走 WAHUBX_DATA_DIR 覆盖
// 生产 (Inno Setup 装后): C:\WAhubX\data\...
// 开发: <cwd>/data/...
export function getDataDir(): string {
  const base = process.env.WAHUBX_DATA_DIR
    ? path.resolve(process.env.WAHUBX_DATA_DIR)
    : path.join(process.cwd(), 'data');
  ensureDir(base);
  return base;
}

export function getSlotDir(slotIndex: number): string {
  const dir = path.join(getDataDir(), 'slots', String(slotIndex).padStart(2, '0'));
  ensureDir(dir);
  return dir;
}

// Baileys creds + keys 目录 (useMultiFileAuthState 读写)
export function getWaSessionDir(slotIndex: number): string {
  const dir = path.join(getSlotDir(slotIndex), 'wa-session');
  ensureDir(dir);
  return dir;
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
