// M11 Day 3 · UpdateService preview 路径测试 · 构造真实 .wupd buffer 跑全流程

import * as archiver from 'archiver';
import * as crypto from 'node:crypto';
import { Ed25519SignerService } from '../signing/ed25519-signer.service';
import { Ed25519VerifierService } from '../signing/ed25519-verifier.service';
import type { WupdManifest } from '../signing/types';
import {
  WUPD_FORMAT_VERSION,
  WUPD_MAGIC_BYTES,
  parseWupdHeader,
  verifyAppSha256,
  verifyMigrations,
} from './wupd-codec';
import { UpdateService } from './update.service';
import { VersionService, parseSemver, semverCompare } from './version.service';

// ── 辅助: 构造 inner zip (app.tar + migrations/*.sql) ──
function buildInnerZip(
  appTar: Buffer,
  migrations: Map<string, Buffer>,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver.create('zip', { zlib: { level: 1 } });
    archive.on('data', (c) => chunks.push(c));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    archive.append(appTar, { name: 'app.tar' });
    for (const [name, buf] of migrations) {
      archive.append(buf, { name: `migrations/${name}.sql` });
    }
    void archive.finalize();
  });
}

// ── 辅助: 组装完整 .wupd buffer ──
async function buildWupd(params: {
  manifest: WupdManifest;
  appTar: Buffer;
  migrations: Map<string, Buffer>;
}): Promise<Buffer> {
  const innerZip = await buildInnerZip(params.appTar, params.migrations);
  const manifestJson = Buffer.from(JSON.stringify(params.manifest), 'utf-8');
  const manifestLen = Buffer.alloc(4);
  manifestLen.writeUInt32BE(manifestJson.length, 0);
  return Buffer.concat([
    WUPD_MAGIC_BYTES,
    Buffer.from([WUPD_FORMAT_VERSION]),
    Buffer.from([0x00, 0x00, 0x00]), // reserved
    manifestLen,
    manifestJson,
    innerZip,
  ]);
}

// ── 测试 key pair 全套共享 ──
let testKeys: { publicKeyHex: string; privateKeyPem: string };
let signer: Ed25519SignerService;

beforeAll(() => {
  const kp = Ed25519SignerService.generateKeyPair();
  testKeys = { publicKeyHex: kp.publicKeyHex, privateKeyPem: kp.privateKeyPem };
  signer = new Ed25519SignerService();
});

describe('version.service · SemVer', () => {
  it('parseSemver · 提取 major/minor/patch/pre', () => {
    const p = parseSemver('0.11.0-m11');
    expect(p.major).toBe(0);
    expect(p.minor).toBe(11);
    expect(p.patch).toBe(0);
    expect(p.pre).toBe('m11');
  });

  it('semverCompare · PATCH/MINOR/MAJOR 顺序正确', () => {
    expect(semverCompare('0.11.0', '0.11.1')).toBe(-1);
    expect(semverCompare('0.12.0', '0.11.0')).toBe(1);
    expect(semverCompare('1.0.0', '0.99.99')).toBe(1);
    expect(semverCompare('0.11.0', '0.11.0')).toBe(0);
    // pre-release: 无 pre > 有 pre
    expect(semverCompare('0.11.0', '0.11.0-m11')).toBe(1);
    expect(semverCompare('0.11.0-m11', '0.11.0-m12')).toBe(-1);
  });
});

describe('UpdateService · preview', () => {
  // 用 Ed25519SignerService 真签 · Verifier 用 testKeys.publicKeyHex 验
  // VersionService 为隔离需 mock (不读真 package.json)
  const mockVersion: VersionService = new VersionService();
  // 让 current = '0.10.0-m10' 方便测试
  jest.spyOn(mockVersion, 'getCurrent').mockReturnValue({
    app_version: '0.10.0-m10',
    installer_fp: {
      arch: 'x64',
      osMajor: 'win10',
      ramBucket: '16G',
      createdAt: '2026-04-20T00:00:00.000Z',
    },
  });

  const verifier = new Ed25519VerifierService();
  const svc = new UpdateService(mockVersion, verifier);

  // 常用测试材料
  const appTar = Buffer.from('fake-app-tar-content-' + 'x'.repeat(1000));
  const appSha = crypto.createHash('sha256').update(appTar).digest('hex');
  const mig1 = Buffer.from('-- migration 1\nSELECT 1;');
  const mig1Sha = crypto.createHash('sha256').update(mig1).digest('hex');
  const mig2 = Buffer.from('-- migration 2\nALTER TABLE foo;');
  const mig2Sha = crypto.createHash('sha256').update(mig2).digest('hex');

  function buildValidManifest(overrides: Partial<WupdManifest> = {}): WupdManifest {
    return {
      from_version: '0.10.0-m10',
      to_version: '0.11.0-m11',
      app_sha256: appSha,
      migrations: [
        { name: 'NewFeature1', sha256: mig1Sha },
        { name: 'NewFeature2', sha256: mig2Sha },
      ],
      health_check: { endpoint: '/api/v1/health', timeout_sec: 60, expect_status: 200 },
      rollback: { strategy: 'restore_pre_update_snapshot' },
      created_at: '2026-04-20T17:00:00.000Z',
      ...overrides,
    };
  }

  function buildMigMap() {
    return new Map([
      ['NewFeature1', mig1],
      ['NewFeature2', mig2],
    ]);
  }

  it('happy path · 所有 check 通过 · can_apply=true', async () => {
    const m = buildValidManifest();
    const signed = signer.sign(m, testKeys.privateKeyPem);
    const wupd = await buildWupd({
      manifest: signed,
      appTar,
      migrations: buildMigMap(),
    });
    // 注入 test public key · 绕 dev placeholder
    jest.spyOn(verifier, 'verify').mockImplementation((mani, opts) =>
      new Ed25519VerifierService().verify(mani, { ...opts, publicKeyHex: testKeys.publicKeyHex }),
    );
    const result = await svc.preview(wupd);
    expect(result.signature_valid).toBe(true);
    expect(result.app_content_valid).toBe(true);
    expect(result.migrations_valid).toBe(true);
    expect(result.version_compat).toBe('ok');
    expect(result.can_apply).toBe(true);
  });

  it('非 .wupd magic · parseWupdHeader 抛 WUPD_MAGIC_MISMATCH', () => {
    const fake = Buffer.concat([Buffer.from('NOPE'), Buffer.alloc(100)]);
    expect(() => parseWupdHeader(fake)).toThrow(/WUPD_MAGIC_MISMATCH/);
  });

  it('from_version 不匹配 current · compat=downgrade', () => {
    const { compat } = mockVersion.assessCompat('99.0.0', '100.0.0');
    expect(compat).toBe('downgrade');
  });

  it('from matches · to == current · compat=same', () => {
    const { compat } = mockVersion.assessCompat('0.10.0-m10', '0.10.0-m10');
    expect(compat).toBe('same');
  });

  it('from matches · MINOR bump · compat=ok', () => {
    const { compat } = mockVersion.assessCompat('0.10.0-m10', '0.11.0-m11');
    expect(compat).toBe('ok');
  });

  it('from matches · MAJOR bump · compat=major-bump', () => {
    const { compat } = mockVersion.assessCompat('0.10.0-m10', '1.0.0');
    expect(compat).toBe('major-bump');
  });

  it('from matches · downgrade · compat=downgrade', () => {
    const { compat } = mockVersion.assessCompat('0.10.0-m10', '0.9.0');
    expect(compat).toBe('downgrade');
  });

  it('app.tar 被改 · preview app_content_valid=false · can_apply=false', async () => {
    const m = buildValidManifest();
    const signed = signer.sign(m, testKeys.privateKeyPem);
    const tampered = Buffer.from('totally-different-content');
    const wupd = await buildWupd({
      manifest: signed,
      appTar: tampered,
      migrations: buildMigMap(),
    });
    jest.spyOn(verifier, 'verify').mockImplementation((mani, opts) =>
      new Ed25519VerifierService().verify(mani, { ...opts, publicKeyHex: testKeys.publicKeyHex }),
    );
    const result = await svc.preview(wupd);
    expect(result.signature_valid).toBe(true); // manifest 没改 · 签名仍有效
    expect(result.app_content_valid).toBe(false); // 但内容不匹配 · 拒
    expect(result.can_apply).toBe(false);
  });

  it('migration 缺失 · migrations_valid=false · issues.missing 列出', async () => {
    const m = buildValidManifest();
    const signed = signer.sign(m, testKeys.privateKeyPem);
    const partialMig = new Map([['NewFeature1', mig1]]); // 缺 NewFeature2
    const wupd = await buildWupd({
      manifest: signed,
      appTar,
      migrations: partialMig,
    });
    jest.spyOn(verifier, 'verify').mockImplementation((mani, opts) =>
      new Ed25519VerifierService().verify(mani, { ...opts, publicKeyHex: testKeys.publicKeyHex }),
    );
    const result = await svc.preview(wupd);
    expect(result.migrations_valid).toBe(false);
    expect(result.migrations_issues?.missing).toContain('NewFeature2');
    expect(result.can_apply).toBe(false);
  });
});

describe('wupd-codec · verifyAppSha256 / verifyMigrations', () => {
  it('verifyAppSha256 · 匹配 true', () => {
    const b = Buffer.from('hello world');
    const sha = crypto.createHash('sha256').update(b).digest('hex');
    expect(verifyAppSha256(b, sha)).toBe(true);
    expect(verifyAppSha256(b, 'x'.repeat(64))).toBe(false);
  });

  it('verifyMigrations · 全匹配 ok=true', () => {
    const b = Buffer.from('m1');
    const sha = crypto.createHash('sha256').update(b).digest('hex');
    const map = new Map([['M1', b]]);
    const r = verifyMigrations(map, [{ name: 'M1', sha256: sha }]);
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.mismatch).toEqual([]);
  });

  it('verifyMigrations · sha 不对 mismatch', () => {
    const map = new Map([['M1', Buffer.from('m1')]]);
    const r = verifyMigrations(map, [{ name: 'M1', sha256: 'x'.repeat(64) }]);
    expect(r.ok).toBe(false);
    expect(r.mismatch).toContain('M1');
  });
});

describe('UpdateService · apply (Day 4 prepare phase)', () => {
  it('apply · 无 BackupExportService 注入 · 返 EXPORT_SVC_UNAVAILABLE', async () => {
    const mockVersion = new VersionService();
    jest.spyOn(mockVersion, 'getCurrent').mockReturnValue({
      app_version: '0.10.0-m10',
      installer_fp: { arch: 'x64', osMajor: 'win10', ramBucket: '16G', createdAt: '2026-04-20T00:00:00.000Z' },
    });
    const verifier = new Ed25519VerifierService();
    const svc = new UpdateService(mockVersion, verifier /* no exportSvc */);

    // 需真 buffer 让 preview 过 · 复用 happy-path 构造
    const appTarLocal = Buffer.from('local-app-tar-' + 'x'.repeat(500));
    const appShaLocal = crypto.createHash('sha256').update(appTarLocal).digest('hex');
    const manifest: WupdManifest = {
      from_version: '0.10.0-m10',
      to_version: '0.11.0-m11',
      app_sha256: appShaLocal,
      migrations: [],
      health_check: { endpoint: '/api/v1/health', timeout_sec: 60, expect_status: 200 },
      rollback: { strategy: 'restore_pre_update_snapshot' },
      created_at: '2026-04-20T17:00:00.000Z',
    };
    const signed = signer.sign(manifest, testKeys.privateKeyPem);
    const wupd = await buildWupd({
      manifest: signed,
      appTar: appTarLocal,
      migrations: new Map(),
    });
    jest.spyOn(verifier, 'verify').mockImplementation((m, opts) =>
      new Ed25519VerifierService().verify(m, { ...opts, publicKeyHex: testKeys.publicKeyHex }),
    );
    const result = await svc.apply(wupd);
    expect(result.code).toBe('EXPORT_SVC_UNAVAILABLE');
  });

  it('apply · preview rejected · 返 PREVIEW_REJECTED 不进 staging', async () => {
    const mockVersion = new VersionService();
    jest.spyOn(mockVersion, 'getCurrent').mockReturnValue({
      app_version: '0.10.0-m10',
      installer_fp: { arch: 'x64', osMajor: 'win10', ramBucket: '16G', createdAt: '2026-04-20T00:00:00.000Z' },
    });
    const verifier = new Ed25519VerifierService();
    const svc = new UpdateService(mockVersion, verifier);

    // 构 .wupd 但 from_version 故意不匹配 → compat=downgrade → can_apply=false
    const appTarLocal = Buffer.from('app');
    const appShaLocal = crypto.createHash('sha256').update(appTarLocal).digest('hex');
    const manifest: WupdManifest = {
      from_version: '99.0.0', // 不匹配 current '0.10.0-m10'
      to_version: '99.0.1',
      app_sha256: appShaLocal,
      migrations: [],
      health_check: { endpoint: '/api/v1/health', timeout_sec: 60, expect_status: 200 },
      rollback: { strategy: 'restore_pre_update_snapshot' },
      created_at: '2026-04-20T17:00:00.000Z',
    };
    const signed = signer.sign(manifest, testKeys.privateKeyPem);
    const wupd = await buildWupd({
      manifest: signed,
      appTar: appTarLocal,
      migrations: new Map(),
    });
    jest.spyOn(verifier, 'verify').mockImplementation((m, opts) =>
      new Ed25519VerifierService().verify(m, { ...opts, publicKeyHex: testKeys.publicKeyHex }),
    );
    const result = await svc.apply(wupd);
    expect(result.code).toBe('PREVIEW_REJECTED');
  });
});
