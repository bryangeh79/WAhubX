// M10 · WabCodec 纯函数测试 (无 DB 依赖)

import * as crypto from 'node:crypto';
import { encodeWab, decodeWab, parseWabHeader, WAB_MAGIC, type WabManifest } from './wab-codec';

function makeManifest(overrides: Partial<WabManifest> = {}): WabManifest {
  return {
    app_version: '0.10.0-m10',
    created_at: new Date('2026-04-20T10:00:00Z').toISOString(),
    schema_hash: 'deadbeef12345678',
    slot_count: 12,
    has_db: true,
    source: 'manual-export',
    tenant_id: 4,
    ...overrides,
  };
}

describe('WabCodec', () => {
  const key = crypto.randomBytes(32);
  const innerZip = Buffer.from('fake-inner-zip-content-0123456789');

  it('encode → decode roundtrip · manifest 和 innerZip 都原样恢复', () => {
    const manifest = makeManifest();
    const wab = encodeWab({ innerZip, key, manifest });
    // magic bytes 开头
    expect(wab.subarray(0, 5).equals(WAB_MAGIC)).toBe(true);
    // decode
    const result = decodeWab({ wab, key });
    expect(result.manifest).toEqual(manifest);
    expect(result.innerZip.equals(innerZip)).toBe(true);
  });

  it('key 不匹配 → WAB_DECRYPT_FAILED', () => {
    const wab = encodeWab({ innerZip, key, manifest: makeManifest() });
    const wrongKey = crypto.randomBytes(32);
    expect(() => decodeWab({ wab, key: wrongKey })).toThrow(/WAB_DECRYPT_FAILED/);
  });

  it('magic bytes 不对 → 明确错误 (非 .wab 文件)', () => {
    // 足够长 · 只是 magic 字节不匹配
    const fake = Buffer.concat([Buffer.from('NOTWB'), Buffer.alloc(100)]);
    expect(() => parseWabHeader(fake)).toThrow(/magic/i);
  });

  it('manifest 被篡改 → GCM auth fail (AAD 绑 manifest)', () => {
    const manifest = makeManifest();
    const wab = encodeWab({ innerZip, key, manifest });
    // 手动改 manifest JSON 一个字节
    // 位置 = magic (5) + ver (1) + iv (12) + tag (16) + manifestLen (4)
    const manifestOffset = 5 + 1 + 12 + 16 + 4;
    const tampered = Buffer.from(wab);
    // 改的不是 JSON 结构 · 改文字 (比如 slot_count 从 12 改)
    const manifestStr = JSON.stringify(manifest);
    const idxInManifest = manifestStr.indexOf('"slot_count":12');
    expect(idxInManifest).toBeGreaterThan(-1);
    // 改数字
    const targetByte = manifestOffset + idxInManifest + '"slot_count":1'.length;
    tampered[targetByte] = '3'.charCodeAt(0); // 改 12 → 13
    expect(() => decodeWab({ wab: tampered, key })).toThrow();
  });
});
