// M10 · MachineBoundMasterKeyProvider · fingerprint 文件持久化 + key 派生

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  MachineBoundMasterKeyProvider,
  computeRawFingerprint,
  getFingerprintFilePath,
} from '../ai/machine-bound-master-key.provider';

describe('MachineBoundMasterKeyProvider', () => {
  const origCwd = process.cwd();
  let tmpCwd: string;

  beforeEach(() => {
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wahubx-mb-'));
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

  it('首次启动 · 生成 fingerprint 文件 · isFreshInstall=true', () => {
    const provider = new MachineBoundMasterKeyProvider();
    expect(provider.isFreshInstall()).toBe(true);
    expect(fs.existsSync(getFingerprintFilePath())).toBe(true);
    // 文件内容 = 64 hex
    const content = fs.readFileSync(getFingerprintFilePath(), 'utf8').trim();
    expect(/^[0-9a-f]{64}$/.test(content)).toBe(true);
    // key 长度 32B (HMAC-SHA256)
    expect(provider.getKey().length).toBe(32);
  });

  it('第二次启动 · 读已有文件 · isFreshInstall=false · key 相同', () => {
    const p1 = new MachineBoundMasterKeyProvider();
    const key1 = p1.getKey();
    const p2 = new MachineBoundMasterKeyProvider();
    expect(p2.isFreshInstall()).toBe(false);
    expect(p2.getKey().equals(key1)).toBe(true);
    expect(p2.source()).toBe(p1.source());
  });

  it('fingerprint 文件非法格式 · 构造抛错指引用户恢复', () => {
    const fpPath = getFingerprintFilePath();
    fs.mkdirSync(path.dirname(fpPath), { recursive: true });
    fs.writeFileSync(fpPath, 'garbage-not-hex');
    expect(() => new MachineBoundMasterKeyProvider()).toThrow(/格式非法/);
  });

  it('computeRawFingerprint · 返 64 位 hex', () => {
    const fp = computeRawFingerprint();
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });
});
