// M11 Day 3 · .wupd 升级包文件格式 codec (读取 · 写入在 Day 5 CI 脚本)
//
// 格式:
//   ┌──────────────────────┬─────────────────────────────────────────────┐
//   │ magic (4B)           │ 'WUPD' (0x57 0x55 0x50 0x44)                 │
//   │ version (1B)         │ 0x01                                         │
//   │ reserved (3B)        │ 0x00 0x00 0x00 · 后续可扩段                 │
//   │ manifest length (4B) │ uint32 BE                                    │
//   │ manifest JSON        │ WupdManifest · 含 signature                  │
//   │ inner zip            │ 含 app.tar + migrations/NNN.ts · 不加密      │
//   └──────────────────────┴─────────────────────────────────────────────┘
//
// 为何 **不加密**:
//   - 公开分发的升级包 · 内容可审计 (开源 spirit)
//   - manifest signature 保完整性 · 加密反而让用户无法手动检查内容
//   - 与 .wab (私密用户数据, AES) 职责区分清楚
//
// 为何 inner zip 而非 tar:
//   - app.tar + migrations/ 两项组合 · zip 天然索引 · 无需顺序扫描
//   - Node zip 生态现成 (archiver + yauzl · 已在 M10 用)

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yauzl from 'yauzl';
import type { WupdManifest } from '../signing/types';

export const WUPD_MAGIC_BYTES = Buffer.from('WUPD', 'utf8');
export const WUPD_FORMAT_VERSION = 0x01;

export interface WupdHeader {
  formatVersion: number;
  manifest: WupdManifest;
  /** ciphertext 起始偏移 (其实不加密 · 是 innerZip 起始偏移) */
  innerZipOffset: number;
  totalBytes: number;
}

/** 仅 parse header · 不解 inner zip · 用于 verify-upd preview */
export function parseWupdHeader(wupd: Buffer): WupdHeader {
  const HEADER_MIN = WUPD_MAGIC_BYTES.length + 1 + 3 + 4;
  if (wupd.length < HEADER_MIN) {
    throw new Error(`WUPD_TOO_SHORT · 文件长度 ${wupd.length}B < 最小 ${HEADER_MIN}B`);
  }
  if (!wupd.subarray(0, 4).equals(WUPD_MAGIC_BYTES)) {
    throw new Error('WUPD_MAGIC_MISMATCH · 不是 .wupd 文件或已损坏');
  }
  const formatVersion = wupd[4];
  if (formatVersion !== WUPD_FORMAT_VERSION) {
    throw new Error(`WUPD_VERSION_UNSUPPORTED · format=${formatVersion} (当前 codec v${WUPD_FORMAT_VERSION})`);
  }
  // reserved[5..7]
  const manifestLen = wupd.readUInt32BE(8);
  if (manifestLen > 1024 * 1024) {
    throw new Error(`WUPD_MANIFEST_TOO_LARGE · ${manifestLen}B > 1MB`);
  }
  const manifestStart = 12;
  const manifestEnd = manifestStart + manifestLen;
  if (manifestEnd > wupd.length) {
    throw new Error('WUPD_MANIFEST_TRUNCATED · 文件不完整');
  }
  const manifestJson = wupd.subarray(manifestStart, manifestEnd).toString('utf-8');
  let manifest: WupdManifest;
  try {
    manifest = JSON.parse(manifestJson);
  } catch (err) {
    throw new Error(
      `WUPD_MANIFEST_INVALID_JSON · ${err instanceof Error ? err.message : err}`,
    );
  }
  return {
    formatVersion,
    manifest,
    innerZipOffset: manifestEnd,
    totalBytes: wupd.length,
  };
}

/** 读 inner zip · 返 {app.tar buffer, migrations map} */
export async function extractWupdPayload(wupd: Buffer): Promise<{
  header: WupdHeader;
  appTar: Buffer;
  migrations: Map<string, Buffer>;
}> {
  const header = parseWupdHeader(wupd);
  const zipBuf = wupd.subarray(header.innerZipOffset);
  const { appTar, migrations } = await extractZip(zipBuf);
  return { header, appTar, migrations };
}

/** 验 app.tar 与 manifest.app_sha256 一致 */
export function verifyAppSha256(appTar: Buffer, expectedHex: string): boolean {
  const actual = crypto.createHash('sha256').update(appTar).digest('hex');
  return actual.toLowerCase() === expectedHex.toLowerCase();
}

/** 验每条 migration 与 manifest.migrations[i].sha256 一致 */
export function verifyMigrations(
  migrationMap: Map<string, Buffer>,
  expected: Array<{ name: string; sha256: string }>,
): { ok: boolean; missing: string[]; mismatch: string[] } {
  const missing: string[] = [];
  const mismatch: string[] = [];
  for (const entry of expected) {
    const buf = migrationMap.get(entry.name);
    if (!buf) {
      missing.push(entry.name);
      continue;
    }
    const actual = crypto.createHash('sha256').update(buf).digest('hex');
    if (actual.toLowerCase() !== entry.sha256.toLowerCase()) mismatch.push(entry.name);
  }
  return { ok: missing.length === 0 && mismatch.length === 0, missing, mismatch };
}

/** 持久化 inner zip 到磁盘 · Day 4 apply 用 · 暴露给 UpdateService */
export function writeAppTarToDisk(appTar: Buffer, destDir: string): string {
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const filePath = path.join(destDir, 'app.tar');
  fs.writeFileSync(filePath, appTar);
  return filePath;
}

// ── 内部: yauzl 解 inner zip ──────────────────────────
function extractZip(zipBuf: Buffer): Promise<{
  appTar: Buffer;
  migrations: Map<string, Buffer>;
}> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(zipBuf, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error('yauzl: no zipfile'));
      let appTar: Buffer | null = null;
      const migrations = new Map<string, Buffer>();
      zipfile.on('error', reject);
      zipfile.on('end', () => {
        if (!appTar) return reject(new Error('WUPD_MISSING_APP_TAR · inner zip 未含 app.tar'));
        resolve({ appTar, migrations });
      });
      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (err2, stream) => {
          if (err2 || !stream) return reject(err2);
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('error', reject);
          stream.on('end', () => {
            const buf = Buffer.concat(chunks);
            if (entry.fileName === 'app.tar') {
              appTar = buf;
            } else if (entry.fileName.startsWith('migrations/')) {
              const name = entry.fileName.replace(/^migrations\//, '').replace(/\.(ts|js|sql)$/, '');
              migrations.set(name, buf);
            }
            // 其他文件忽略
            zipfile.readEntry();
          });
        });
      });
    });
  });
}
