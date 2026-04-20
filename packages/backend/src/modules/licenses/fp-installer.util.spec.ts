// M11 Preamble · fp-installer 纯函数 + 迁移测试

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  computeInstallerFingerprint,
  deriveOsMajor,
  deriveRamBucket,
  getFpInstallerFilePath,
  readOrCreateFpInstaller,
} from './fp-installer.util';

describe('fp-installer.util', () => {
  const origCwd = process.cwd();
  let tmpCwd: string;

  beforeEach(() => {
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wahubx-fpi-'));
    process.chdir(tmpCwd);
  });

  afterEach(() => {
    process.chdir(origCwd);
    try {
      fs.rmSync(tmpCwd, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('deriveRamBucket · 档位边界正确 · 向下取档', () => {
    expect(deriveRamBucket(5 * 1024 ** 3)).toBe('4G'); // 5G → 4G
    expect(deriveRamBucket(8 * 1024 ** 3)).toBe('8G');
    expect(deriveRamBucket(16 * 1024 ** 3)).toBe('16G');
    expect(deriveRamBucket(32 * 1024 ** 3)).toBe('32G');
    expect(deriveRamBucket(64 * 1024 ** 3)).toBe('64G+');
    expect(deriveRamBucket(128 * 1024 ** 3)).toBe('64G+');
  });

  it('deriveOsMajor · 非空字符串 · 匹配已知或 fallback', () => {
    const r = deriveOsMajor();
    expect(typeof r).toBe('string');
    expect(r.length).toBeGreaterThan(0);
  });

  it('computeInstallerFingerprint · 含所有字段 + installerVersion=1.0', () => {
    const fp = computeInstallerFingerprint();
    expect(fp.arch).toBe(os.arch());
    expect(fp.osMajor).toBeTruthy();
    expect(fp.ramBucket).toBeTruthy();
    expect(fp.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(fp.installerVersion).toBe('1.0');
  });

  it('readOrCreateFpInstaller · 首次调用 · 写入文件 · wasFreshlyGenerated=true', () => {
    const result = readOrCreateFpInstaller();
    expect(result.wasFreshlyGenerated).toBe(true);
    expect(result.matches).toBe(true); // 第一次 stored=current
    expect(fs.existsSync(getFpInstallerFilePath())).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(getFpInstallerFilePath(), 'utf-8'));
    expect(parsed.arch).toBe(os.arch());
  });

  it('readOrCreateFpInstaller · 二次调用 · 读已有文件 · 不重写 · matches=true', () => {
    const first = readOrCreateFpInstaller();
    const firstCreatedAt = first.stored.createdAt;
    // 重调
    const second = readOrCreateFpInstaller();
    expect(second.wasFreshlyGenerated).toBe(false);
    expect(second.matches).toBe(true);
    expect(second.stored.createdAt).toBe(firstCreatedAt); // createdAt 不变 (读已有)
  });

  it('readOrCreateFpInstaller · 存档的硬件已变 (伪造不匹配) · matches=false', () => {
    // 手动写一个假指纹 · arch 不同
    const fpPath = getFpInstallerFilePath();
    fs.writeFileSync(
      fpPath,
      JSON.stringify({
        arch: 'foreign-arch',
        osMajor: 'foreign-os',
        ramBucket: '4G',
        createdAt: '2020-01-01T00:00:00.000Z',
        installerVersion: '1.0',
      }),
    );
    const result = readOrCreateFpInstaller();
    expect(result.wasFreshlyGenerated).toBe(false);
    expect(result.matches).toBe(false); // 硬件不同
    expect(result.stored.arch).toBe('foreign-arch');
    expect(result.current.arch).toBe(os.arch());
  });

  it('readOrCreateFpInstaller · 损坏 JSON · 重写为当前指纹 · wasFreshlyGenerated=true', () => {
    const fpPath = getFpInstallerFilePath();
    fs.mkdirSync(path.dirname(fpPath), { recursive: true });
    fs.writeFileSync(fpPath, 'not-json-garbage');
    const result = readOrCreateFpInstaller();
    expect(result.wasFreshlyGenerated).toBe(true); // treated as fresh
  });
});
