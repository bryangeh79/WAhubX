// M10 · .wab 文件格式 codec (§B.11 Layer 2 手动导出导入)
//
// 格式:
//   ┌──────────────────────┬──────────────────────────────────────────────────┐
//   │ magic bytes (5B)     │ "WAHUB" (0x57 0x41 0x48 0x55 0x42)                │
//   │ version (1B)         │ 0x01 (格式版本)                                  │
//   │ IV (12B)             │ AES-256-GCM nonce · 每次导出 crypto.randomBytes │
//   │ auth tag (16B)       │ AES-256-GCM 认证 tag (解密后校验)                │
//   │ manifest length (4B) │ uint32 BE · manifest JSON 字节数                 │
//   │ manifest JSON        │ 明文 · {from_version, created_at, schema_hash,  │
//   │                      │  slot_count, has_db, ...}                       │
//   │ ciphertext           │ AES-256-GCM 加密的 inner zip (含 db.sql + slots/)│
//   └──────────────────────┴──────────────────────────────────────────────────┘
//
// 为何 manifest 明文:
//   - 导入前预览 (版本 / 建立时间 / 槽数) 不需要密钥
//   - 密钥不匹配时能给明确错误 ("这个 .wab 是 v2, 当前支持 v1")
//   - schema_hash 让跨 schema 版本导入提前拒绝 (避免灌进去才发现列不匹配)
//
// 为何 inner 是 zip 再 GCM 包:
//   - Zip 给压缩 + 结构化多文件 (db.sql + slots/01.zip + slots/02.zip + ...)
//   - GCM 给机密性 + 完整性 · 外层一次加密 · 中途被改动会 decrypt 失败
//
// 密钥: 外部传入 32B Buffer (来自 MasterKeyProvider.getKey())

import { Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';

export const WAB_MAGIC = Buffer.from('WAHUB', 'utf8');
export const WAB_VERSION = 0x01;
const IV_LEN = 12;
const TAG_LEN = 16;
const MANIFEST_LEN_LEN = 4;

export interface WabManifest {
  // 当前 app 版本 (CHANGELOG 最新 tag); 跨大版本导入前警告
  app_version: string;
  created_at: string; // ISO
  // schema 版本 · 对应 migrations 表最后一项 timestamp · 防跨 schema 导入
  schema_hash: string;
  // 内含多少 slot 子 zip (统计用)
  slot_count: number;
  // 是否包含 DB dump (手动 export 总是 true; 单槽小快照不用此 codec 格式)
  has_db: boolean;
  // 生成源 · 区分 manual-export / pre-migration / pre-import 自动备份
  source: 'manual-export' | 'pre-migration' | 'pre-import';
  // 租户 ID · 导入时校验是否同租户 (若不匹配提示 "跨租户导入可能有数据关联断裂")
  tenant_id: number | null;
  // 可选 · 备注
  notes?: string;
}

/**
 * 把 inner zip buffer 编码成 .wab 格式.
 * key 必须 32B (AES-256-GCM 要求).
 */
export function encodeWab(params: {
  innerZip: Buffer;
  key: Buffer;
  manifest: WabManifest;
}): Buffer {
  if (params.key.length !== 32) throw new Error(`wab key 必须 32B, got ${params.key.length}`);

  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', params.key, iv);
  const manifestJson = Buffer.from(JSON.stringify(params.manifest), 'utf8');

  // AAD 绑 manifest · 防攻击者替换 manifest 不触发 auth fail
  cipher.setAAD(manifestJson);
  const ciphertext = Buffer.concat([cipher.update(params.innerZip), cipher.final()]);
  const tag = cipher.getAuthTag();

  const manifestLen = Buffer.alloc(MANIFEST_LEN_LEN);
  manifestLen.writeUInt32BE(manifestJson.length, 0);

  return Buffer.concat([
    WAB_MAGIC,
    Buffer.from([WAB_VERSION]),
    iv,
    tag,
    manifestLen,
    manifestJson,
    ciphertext,
  ]);
}

export interface WabHeader {
  version: number;
  manifest: WabManifest;
  iv: Buffer;
  tag: Buffer;
  // ciphertext 的起始偏移 · 方便流式处理 (V1 全 buffer 加载简单粗暴)
  ciphertextOffset: number;
}

/**
 * 仅读 header (不 decrypt) · 用于导入前预览 / 拒绝不兼容格式
 */
export function parseWabHeader(wab: Buffer): WabHeader {
  if (wab.length < WAB_MAGIC.length + 1 + IV_LEN + TAG_LEN + MANIFEST_LEN_LEN) {
    throw new Error('wab 文件过短');
  }
  if (!wab.subarray(0, WAB_MAGIC.length).equals(WAB_MAGIC)) {
    throw new Error('wab magic bytes 不匹配 (不是 .wab 文件或已损坏)');
  }
  let offset = WAB_MAGIC.length;
  const version = wab[offset++];
  if (version !== WAB_VERSION) {
    throw new Error(`wab 版本 ${version} 不支持 · 当前 codec v${WAB_VERSION}`);
  }
  const iv = wab.subarray(offset, offset + IV_LEN);
  offset += IV_LEN;
  const tag = wab.subarray(offset, offset + TAG_LEN);
  offset += TAG_LEN;
  const manifestLen = wab.readUInt32BE(offset);
  offset += MANIFEST_LEN_LEN;
  if (manifestLen > 1024 * 1024) throw new Error(`manifest 过大 ${manifestLen}B (> 1MB)`);
  if (offset + manifestLen > wab.length) throw new Error('wab 文件被截断 · manifest 不完整');
  const manifestJson = wab.subarray(offset, offset + manifestLen);
  offset += manifestLen;
  let manifest: WabManifest;
  try {
    manifest = JSON.parse(manifestJson.toString('utf8'));
  } catch (err) {
    throw new Error(`manifest JSON 非法: ${err instanceof Error ? err.message : err}`);
  }
  return { version, manifest, iv, tag, ciphertextOffset: offset };
}

/**
 * 解密 .wab → inner zip buffer
 * key 不匹配 / 文件被改 → throw (GCM auth fail)
 */
export function decodeWab(params: { wab: Buffer; key: Buffer }): { manifest: WabManifest; innerZip: Buffer } {
  const logger = new Logger('wab-codec');
  if (params.key.length !== 32) throw new Error(`wab key 必须 32B, got ${params.key.length}`);

  const header = parseWabHeader(params.wab);
  const ciphertext = params.wab.subarray(header.ciphertextOffset);
  const manifestJson = Buffer.from(JSON.stringify(header.manifest), 'utf8');

  const decipher = crypto.createDecipheriv('aes-256-gcm', params.key, header.iv);
  decipher.setAAD(manifestJson);
  decipher.setAuthTag(header.tag);

  try {
    const innerZip = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return { manifest: header.manifest, innerZip };
  } catch (err) {
    logger.warn(`wab decrypt failed · 密钥不匹配或文件被篡改: ${err instanceof Error ? err.message : err}`);
    throw new Error(
      'WAB_DECRYPT_FAILED: 密钥不匹配或文件被篡改. ' +
      '若硬件变过, 走 E2 recovery (settings 页 "恢复加密密钥"). ' +
      '若文件来自不同 machine 的备份, 需导入源机器的 master-key-fingerprint.txt.',
    );
  }
}
