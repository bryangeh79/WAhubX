// M11 Day 2 · Manifest canonical JSON 序列化 + 签名字段处理
//
// **canonical JSON** = key 字母升序 + 数组顺序保留 + 无多余空白 + UTF-8
//   - 签名输入必须 bit-for-bit 一致 · 不同平台不同实现也签得出同 signature
//   - 节省: 只 sort top-level keys + 递归 sort object keys · 数组内顺序是 payload 语义保留
//   - 与 RFC 8785 兼容性: 本实现未做全部 edge case (e.g. float 精度) · 但 manifest 全是 string/int · 足够

import type { WupdManifest } from './types';

/**
 * 递归 · 把 object 的 keys 按字母序排 · 其他类型原样返
 * 数组内部递归但不排元素顺序 (数组是有序 list, 不是 set)
 */
function sortKeysRecursive(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sortKeysRecursive);
  const obj = v as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    sorted[k] = sortKeysRecursive(obj[k]);
  }
  return sorted;
}

/**
 * 把 manifest **不含 signature** 的部分序列化为 canonical JSON · 返 UTF-8 Buffer
 *
 * 设计:
 *   - 移除 signature 字段 (不让签名包含自己)
 *   - sort keys · 保证跨平台一致
 *   - 无缩进 · 紧凑
 *   - UTF-8 编码
 */
export function canonicalSerialize(manifest: WupdManifest): Buffer {
  const clone: Record<string, unknown> = { ...(manifest as unknown as Record<string, unknown>) };
  delete clone.signature;
  const canonical = sortKeysRecursive(clone);
  const json = JSON.stringify(canonical);
  return Buffer.from(json, 'utf8');
}

/**
 * 拆 signature 字符串 · 'ed25519:<base64url-64B>' → { scheme, signatureBuf }
 *
 * 错误情况:
 *   - 空 / 无 prefix → throw 'MISSING_SIGNATURE'
 *   - prefix 非 ed25519 → throw 'UNSUPPORTED_SIG_SCHEME' (V2 换算法时换前缀)
 *   - base64url 解码后非 64B → throw 'INVALID_SIGNATURE_LENGTH'
 */
export function parseSignatureField(signature: string | undefined): {
  scheme: 'ed25519';
  signatureBuf: Buffer;
} {
  if (!signature) {
    throw new Error('MISSING_SIGNATURE · manifest 未签名');
  }
  const parts = signature.split(':');
  if (parts.length !== 2) {
    throw new Error(`SIGNATURE_FORMAT · 格式须 'scheme:<base64url>', got '${signature.slice(0, 30)}'`);
  }
  const [scheme, b64] = parts;
  if (scheme !== 'ed25519') {
    throw new Error(`UNSUPPORTED_SIG_SCHEME · 仅支持 ed25519, got '${scheme}'`);
  }
  // base64url → Buffer (Node 支ports 'base64url' since v16)
  const buf = Buffer.from(b64, 'base64url');
  if (buf.length !== 64) {
    throw new Error(`INVALID_SIGNATURE_LENGTH · Ed25519 签名必须 64B, got ${buf.length}B`);
  }
  return { scheme: 'ed25519', signatureBuf: buf };
}

/**
 * 构造带签名字符串的 manifest · sign 结果填回 signature 字段
 */
export function buildSignatureField(signatureBuf: Buffer): string {
  if (signatureBuf.length !== 64) {
    throw new Error(`Ed25519 签名必须 64B, got ${signatureBuf.length}B`);
  }
  return `ed25519:${signatureBuf.toString('base64url')}`;
}
