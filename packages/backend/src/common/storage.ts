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

// 媒体文件落盘: data/slots/<slotIndex>/media/<filename>
export function getMediaDir(slotIndex: number): string {
  const dir = path.join(getSlotDir(slotIndex), 'media');
  ensureDir(dir);
  return dir;
}

export function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── M7 素材库路径 helper · Day 1 #10 ───────────────────
//
// 素材库磁盘布局 (与 asset.entity.ts 注释 + §B.16 对齐):
//   data/assets/<kind>/<pool>/<filename>             · 用户生成/导入池
//   data/assets/_builtin/<kind>/<pool>/<filename>    · installer 预置 seed 池
//
// kind ∈ voices/images/files/stickers (复数 · 与前端路径习惯保持一致)
// pool 例: casual_laugh / food_malaysian / greeting_morning

export function getAssetsDir(): string {
  const dir = path.join(getDataDir(), 'assets');
  ensureDir(dir);
  return dir;
}

/** 用户生成/导入池 · data/assets/<kind>/<pool> */
export function getAssetPoolDir(kind: string, poolName: string): string {
  const dir = path.join(getAssetsDir(), kind, poolName);
  ensureDir(dir);
  return dir;
}

/** installer 预置 seed 池 · data/assets/_builtin/<kind>/<pool> · 只读 */
export function getBuiltinAssetPoolDir(kind: string, poolName: string): string {
  const dir = path.join(getAssetsDir(), '_builtin', kind, poolName);
  // 不 ensureDir · installer 装后才有 · 消费方自查 exists
  return dir;
}

/** 绝对路径 · 素材文件 · data/assets/<kind>/<pool>/<filename> */
export function getAssetFilePath(kind: string, poolName: string, filename: string): string {
  return path.join(getAssetPoolDir(kind, poolName), filename);
}

/** 相对 data/ 的路径 · 用于存 asset.file_path (db 内字段) */
export function toAssetRelativePath(kind: string, poolName: string, filename: string): string {
  // 统一 forward slash · 跨平台一致 (Windows 存 backslash 会炸 import)
  return ['assets', kind, poolName, filename].join('/');
}
