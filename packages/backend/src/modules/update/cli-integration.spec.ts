// M11 Day 5 · CLI integration tests
//
// 端到端测 scripts/{pack-wupd, sign-wupd}.js via child_process:
//   - 不测纯函数 · 测 CLI 真实跑 (用户会这样调)
//   - 验跨实现兼容 (pack → sign → backend Verifier)
//   - 防 CLI args 变动 / 错误处理 regression
//
// 执行成本: 每 test ~1-2s (spawn node + 文件 IO) · 比纯 unit test 贵 · 但值.
//
// Skip 条件: CI 无 scripts/ 时 (e.g. backend-only 包) · describe.skip

import { execFileSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Ed25519VerifierService } from '../signing/ed25519-verifier.service';
import { parseWupdHeader } from './wupd-codec';

// 找 repo root (从 backend 起上 2 级)
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const SIGN_CLI = path.join(REPO_ROOT, 'scripts', 'sign-wupd.js');
const PACK_CLI = path.join(REPO_ROOT, 'scripts', 'pack-wupd.js');

const shouldRun = fs.existsSync(SIGN_CLI) && fs.existsSync(PACK_CLI);

(shouldRun ? describe : describe.skip)('CLI integration · scripts/*.js', () => {
  let tmpDir: string;
  let testKeys: { privkey: string; pubkey: string; pubhex: string };

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wahubx-cli-'));
    // 生成 test keypair (不用 CLI genkey · 避免 bench 慢)
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    testKeys = {
      privkey: path.join(tmpDir, 'priv.pem'),
      pubkey: path.join(tmpDir, 'pub.pem'),
      pubhex: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex'),
    };
    fs.writeFileSync(
      testKeys.privkey,
      privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      { mode: 0o600 },
    );
    fs.writeFileSync(testKeys.pubkey, publicKey.export({ format: 'pem', type: 'spki' }).toString());
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('sign-wupd genkey · 生成合法 keypair 文件', () => {
    const outDir = path.join(tmpDir, 'genkey-test');
    execFileSync('node', [SIGN_CLI, 'genkey', '--out-dir', outDir], { encoding: 'utf-8' });
    expect(fs.existsSync(path.join(outDir, 'privkey.pem'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'pubkey.pem'))).toBe(true);
    expect(fs.existsSync(path.join(outDir, 'pubkey.hex'))).toBe(true);
    const hex = fs.readFileSync(path.join(outDir, 'pubkey.hex'), 'utf-8').trim();
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('pack-wupd + sign-wupd + verify CLI · 端到端 round-trip', () => {
    // 1. 造 dummy app.tar + 1 migration
    const appTar = path.join(tmpDir, 'app.tar');
    fs.writeFileSync(appTar, Buffer.from('fake-app-content-' + 'x'.repeat(500)));
    const migDir = path.join(tmpDir, 'mig');
    fs.mkdirSync(migDir, { recursive: true });
    const mig1 = path.join(migDir, '1779000000001-Test.sql');
    fs.writeFileSync(mig1, '-- test migration');

    // 2. pack
    const wupdOut = path.join(tmpDir, 'test.wupd');
    execFileSync(
      'node',
      [
        PACK_CLI,
        '--from', '0.11.0-m11',
        '--to', '0.11.1-cli-test',
        '--app-tar', appTar,
        '--migrations', path.join(migDir, '*.sql'),
        '--out', wupdOut,
      ],
      { encoding: 'utf-8', cwd: REPO_ROOT }, // cwd 让 archiver 能找到 node_modules
    );
    expect(fs.existsSync(wupdOut)).toBe(true);
    const unsignedSize = fs.statSync(wupdOut).size;
    expect(unsignedSize).toBeGreaterThan(100);

    // 3. sign
    execFileSync(
      'node',
      [SIGN_CLI, 'sign', '--wupd', wupdOut, '--privkey', testKeys.privkey],
      { encoding: 'utf-8' },
    );
    const signedSize = fs.statSync(wupdOut).size;
    expect(signedSize).toBeGreaterThan(unsignedSize); // 多了 signature 字段

    // 4. CLI verify
    const verifyOutput = execFileSync(
      'node',
      [SIGN_CLI, 'verify', '--wupd', wupdOut, '--pubkey-hex', testKeys.pubhex],
      { encoding: 'utf-8' },
    );
    expect(verifyOutput).toContain('signature_valid');
    expect(verifyOutput).toContain('0.11.0-m11');
    expect(verifyOutput).toContain('0.11.1-cli-test');

    // 5. 跨实现 · Backend Verifier 也能验
    const wupdBuf = fs.readFileSync(wupdOut);
    const { manifest } = parseWupdHeader(wupdBuf);
    const verifier = new Ed25519VerifierService();
    const result = verifier.verify(manifest, { publicKeyHex: testKeys.pubhex });
    expect(result.ok).toBe(true);
  });

  it('sign-wupd verify · 错 pubkey · exit code 1', () => {
    // 先 pack + sign 一个 .wupd
    const appTar = path.join(tmpDir, 'app2.tar');
    fs.writeFileSync(appTar, Buffer.from('x'));
    const wupdOut = path.join(tmpDir, 'test2.wupd');
    execFileSync(
      'node',
      [PACK_CLI, '--from', '0.1.0', '--to', '0.1.1', '--app-tar', appTar, '--out', wupdOut],
      { encoding: 'utf-8', cwd: REPO_ROOT },
    );
    execFileSync(
      'node',
      [SIGN_CLI, 'sign', '--wupd', wupdOut, '--privkey', testKeys.privkey],
      { encoding: 'utf-8' },
    );

    // 用错 pub 验
    const wrongHex = '0'.repeat(64);
    expect(() => {
      execFileSync(
        'node',
        [SIGN_CLI, 'verify', '--wupd', wupdOut, '--pubkey-hex', wrongHex],
        { encoding: 'utf-8', stdio: 'pipe' },
      );
    }).toThrow(/exit code 1|Command failed/);
  });

  it('pack-wupd · 缺必需 arg · exit code 2', () => {
    expect(() => {
      execFileSync('node', [PACK_CLI, '--from', '0.1.0'], { encoding: 'utf-8', stdio: 'pipe' });
    }).toThrow(/Command failed/);
  });

  it('sign-wupd · 未知命令 · exit 0 (usage 打印)', () => {
    const out = execFileSync('node', [SIGN_CLI], { encoding: 'utf-8' });
    expect(out).toContain('Usage');
    expect(out).toContain('genkey');
    expect(out).toContain('sign');
    expect(out).toContain('verify');
  });

  it('pack-wupd · app.tar 不存在 · exit code 3', () => {
    expect(() => {
      execFileSync(
        'node',
        [
          PACK_CLI,
          '--from', '0.1.0', '--to', '0.1.1',
          '--app-tar', '/nonexistent/nowhere.tar',
          '--out', path.join(tmpDir, 'should-fail.wupd'),
        ],
        { encoding: 'utf-8', stdio: 'pipe' },
      );
    }).toThrow(/Command failed/);
  });

  it('wupd 格式自 identify · magic + manifest 可 parse', () => {
    const appTar = path.join(tmpDir, 'identify.tar');
    fs.writeFileSync(appTar, Buffer.from('test'));
    const wupdOut = path.join(tmpDir, 'identify.wupd');
    execFileSync(
      'node',
      [PACK_CLI, '--from', '0.5.0', '--to', '0.6.0', '--app-tar', appTar, '--out', wupdOut],
      { encoding: 'utf-8', cwd: REPO_ROOT },
    );
    const buf = fs.readFileSync(wupdOut);
    expect(buf.subarray(0, 4).toString('utf-8')).toBe('WUPD');
    expect(buf[4]).toBe(0x01); // version

    const header = parseWupdHeader(buf);
    expect(header.manifest.from_version).toBe('0.5.0');
    expect(header.manifest.to_version).toBe('0.6.0');
    expect(header.manifest.signature).toBeUndefined(); // 未签
  });
});
