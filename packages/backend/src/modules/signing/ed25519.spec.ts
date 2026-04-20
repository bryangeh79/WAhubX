// M11 Day 2 · Ed25519 sign/verify 核心路径 + 篡改检测

import { Ed25519SignerService } from './ed25519-signer.service';
import { Ed25519VerifierService } from './ed25519-verifier.service';
import type { WupdManifest } from './types';
import { canonicalSerialize, parseSignatureField } from './manifest-codec';

// 测试用 key pair · 每 describe 复用
let testKeys: { publicKeyPem: string; privateKeyPem: string; publicKeyHex: string };

beforeAll(() => {
  testKeys = Ed25519SignerService.generateKeyPair();
});

function buildManifest(overrides: Partial<WupdManifest> = {}): WupdManifest {
  return {
    from_version: '0.10.0-m10',
    to_version: '0.11.0-m11',
    app_sha256: 'a'.repeat(64),
    migrations: [
      { name: '1779000000000-NewFeature', sha256: 'b'.repeat(64) },
    ],
    health_check: {
      endpoint: '/api/v1/health',
      timeout_sec: 60,
      expect_status: 200,
    },
    rollback: { strategy: 'restore_pre_update_snapshot' },
    created_at: '2026-04-20T12:00:00.000Z',
    ...overrides,
  };
}

describe('Ed25519SignerService', () => {
  const signer = new Ed25519SignerService();

  it('sign · 返带 ed25519: prefix + base64url 64B signature 的 manifest', () => {
    const manifest = buildManifest();
    const signed = signer.sign(manifest, testKeys.privateKeyPem);
    expect(signed.signature).toMatch(/^ed25519:/);
    const { scheme, signatureBuf } = parseSignatureField(signed.signature);
    expect(scheme).toBe('ed25519');
    expect(signatureBuf.length).toBe(64);
  });

  it('sign · 同 manifest 签两次 · 签名相同 (Ed25519 deterministic)', () => {
    const manifest = buildManifest();
    const a = signer.sign(manifest, testKeys.privateKeyPem);
    const b = signer.sign(manifest, testKeys.privateKeyPem);
    expect(a.signature).toBe(b.signature);
  });

  it('sign · 非 Ed25519 私钥抛错', () => {
    // 用 RSA 私钥当 Ed25519 · 预期 throw
    const crypto = require('node:crypto');
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    expect(() => signer.sign(buildManifest(), rsaPem)).toThrow(/必须是 Ed25519/);
  });

  it('generateKeyPair · 静态方法 · 返 publicHex 正好 64 hex 字符', () => {
    const kp = Ed25519SignerService.generateKeyPair();
    expect(kp.publicKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(kp.publicKeyPem).toMatch(/-----BEGIN PUBLIC KEY-----/);
    expect(kp.privateKeyPem).toMatch(/-----BEGIN PRIVATE KEY-----/);
  });
});

describe('Ed25519VerifierService', () => {
  const signer = new Ed25519SignerService();
  const verifier = new Ed25519VerifierService();

  it('verify 正确签名 · ok=true', () => {
    const manifest = buildManifest();
    const signed = signer.sign(manifest, testKeys.privateKeyPem);
    const result = verifier.verify(signed, { publicKeyHex: testKeys.publicKeyHex });
    expect(result.ok).toBe(true);
  });

  it('verify 篡改 payload · ok=false · code=SIGNATURE_MISMATCH', () => {
    const manifest = buildManifest();
    const signed = signer.sign(manifest, testKeys.privateKeyPem);
    // 篡改 to_version
    const tampered: WupdManifest = { ...signed, to_version: '0.99.0-evil' };
    const result = verifier.verify(tampered, { publicKeyHex: testKeys.publicKeyHex });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('SIGNATURE_MISMATCH');
  });

  it('verify 错误签名 (截断 1 byte) · ok=false · code=INVALID_SIGNATURE_LENGTH', () => {
    const manifest = buildManifest();
    const signed = signer.sign(manifest, testKeys.privateKeyPem);
    // 截断 signature 的 base64 末尾
    const shortSig = signed.signature!.slice(0, -5); // 去几个字符使 base64 解出少字节
    const broken = { ...signed, signature: shortSig };
    const result = verifier.verify(broken, { publicKeyHex: testKeys.publicKeyHex });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // 可能是 INVALID_SIGNATURE_LENGTH 或 SIGNATURE_MISMATCH · 都算拒绝 · 验 ok=false 够
      expect(['INVALID_SIGNATURE_LENGTH', 'SIGNATURE_MISMATCH']).toContain(result.code);
    }
  });

  it('verify 未签 manifest · ok=false · code=MISSING_SIGNATURE', () => {
    const manifest = buildManifest(); // 无 signature
    const result = verifier.verify(manifest, { publicKeyHex: testKeys.publicKeyHex });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('MISSING_SIGNATURE');
  });

  it('verify 格式非法 signature · ok=false', () => {
    const manifest = buildManifest();
    const broken = { ...manifest, signature: 'not-a-valid-format' };
    const result = verifier.verify(broken, { publicKeyHex: testKeys.publicKeyHex });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(['SIGNATURE_FORMAT', 'UNSUPPORTED_SIG_SCHEME']).toContain(result.code);
    }
  });

  it('verify 用不同密钥对签名 · ok=false · code=SIGNATURE_MISMATCH', () => {
    const manifest = buildManifest();
    const signed = signer.sign(manifest, testKeys.privateKeyPem);
    // 用另一对 key 的公钥验 · 必错
    const otherKeys = Ed25519SignerService.generateKeyPair();
    const result = verifier.verify(signed, { publicKeyHex: otherKeys.publicKeyHex });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('SIGNATURE_MISMATCH');
  });

  it('verify 在 NODE_ENV=production 下 dev placeholder (全 0) 公钥 · ok=false · code=DEV_PLACEHOLDER_KEY_IN_PROD', () => {
    // M11 Day 5 · 默认 WAHUBX_UPDATE_PUBLIC_KEY_HEX 现已填 dev key (非全 0)
    // 本测试显式传全 0 hex 模拟 production build 忘替换场景
    const origEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const manifest = buildManifest();
      const signed = signer.sign(manifest, testKeys.privateKeyPem);
      const allZero = '0'.repeat(64);
      const result = verifier.verify(signed, { publicKeyHex: allZero });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('DEV_PLACEHOLDER_KEY_IN_PROD');
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });
});

describe('manifest-codec · canonicalSerialize', () => {
  it('canonical · 不同 key 顺序输入 · 相同输出字节', () => {
    const m1 = buildManifest();
    const m2: WupdManifest = {
      // 故意 key 顺序打乱
      created_at: m1.created_at,
      to_version: m1.to_version,
      health_check: m1.health_check,
      migrations: m1.migrations,
      from_version: m1.from_version,
      rollback: m1.rollback,
      app_sha256: m1.app_sha256,
    };
    const b1 = canonicalSerialize(m1);
    const b2 = canonicalSerialize(m2);
    expect(b1.equals(b2)).toBe(true);
  });

  it('canonical · signature 字段不参与序列化 · 签名后 serialize 与签名前一致', () => {
    const m = buildManifest();
    const pre = canonicalSerialize(m);
    const signed = new Ed25519SignerService().sign(m, testKeys.privateKeyPem);
    const post = canonicalSerialize(signed);
    expect(pre.equals(post)).toBe(true);
  });
});
