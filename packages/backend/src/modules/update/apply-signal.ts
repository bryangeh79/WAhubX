// M11 Day 4 · Apply Signal File 机制
//
// 为何需要 signal file:
//   - Node 进程无法替换自己在磁盘的 exe (Windows 文件锁 · POSIX 可以但我们有 Windows 约束)
//   - 必须有**外壳进程** (installer wrapper · Inno Setup 编译的 util)
//   - Backend 准备好 staging → 写 signal file → backend 退出 → installer 外壳监测 signal file
//     开始 rename dance (app/ → app-old/, staging/ → app/) → 起新 backend
//
// Signal file JSON 内容:
//   {
//     staging_path: "C:\\WAhubX\\updates\\staging\\<ts>",  // installer 从这里 rename 到 app/
//     pre_update_wab_path: "C:\\WAhubX\\backups\\pre-update\\<ts>.wab",  // 回滚用
//     old_app_rename_to: "C:\\WAhubX\\app-old-<ts>",        // 原 app/ 改名到这
//     manifest: {...},                                      // 升级内容预览
//     written_at: "ISO"
//   }
//
// 若 signal file 已存在 (上次 apply 未完成 or crash) · 新 apply 拒绝 · 指引用户手动清理
//
// V1 不做: signal file crash recovery (installer crash mid-rename). 对齐 M11 构想 ·
// 用户可手动从 pre-update.wab restore · 或重装 installer.

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WupdManifest } from '../signing/types';

export interface ApplySignal {
  version: 1;
  written_at: string;
  /** 解压后的 staging 目录 · installer 从这里拷走 */
  staging_path: string;
  /** pre-update 备份路径 · 失败时 installer 回滚源 */
  pre_update_wab_path: string;
  /** 原 app/ 暂 rename 到此路径 · 失败回滚时 rename 回来 */
  old_app_rename_to: string;
  manifest: WupdManifest;
}

export function getSignalFilePath(): string {
  // 独立路径 · 不放 data/ 也不放 backups/ · 固定在 updates/staging/ 便于 installer 找
  const base = process.env.WAHUBX_DATA_DIR
    ? path.resolve(process.env.WAHUBX_DATA_DIR, '..')
    : path.resolve(process.cwd(), '..');
  const dir = path.join(base, 'updates', 'staging');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'apply.signal.json');
}

export function getStagingRoot(): string {
  const base = process.env.WAHUBX_DATA_DIR
    ? path.resolve(process.env.WAHUBX_DATA_DIR, '..')
    : path.resolve(process.cwd(), '..');
  const dir = path.join(base, 'updates', 'staging');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function readSignal(): ApplySignal | null {
  const p = getSignalFilePath();
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (parsed.version === 1) return parsed as ApplySignal;
    return null;
  } catch {
    return null;
  }
}

export function writeSignal(signal: Omit<ApplySignal, 'version' | 'written_at'>): string {
  const full: ApplySignal = {
    version: 1,
    written_at: new Date().toISOString(),
    ...signal,
  };
  const p = getSignalFilePath();
  fs.writeFileSync(p, JSON.stringify(full, null, 2), 'utf-8');
  return p;
}

export function clearSignal(): void {
  const p = getSignalFilePath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

/** 检测残留 signal · apply 前必 call · 存在 → 拒 */
export function assertNoStaleSignal(): void {
  const existing = readSignal();
  if (existing) {
    throw new Error(
      `APPLY_SIGNAL_STALE · ${getSignalFilePath()} 存在上次未完成升级 · ` +
      `手动处理: 从 ${existing.pre_update_wab_path} restore + 删 signal file 后重试`,
    );
  }
}
