// M11 Preamble · fp-master-key 旧 → 新名迁移测试 (M10 遗留名 → M11 规范名)

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  MachineBoundMasterKeyProvider,
  getFingerprintFilePath,
  getLegacyFingerprintFilePath,
  migrateLegacyMasterKeyFingerprint,
} from './machine-bound-master-key.provider';

describe('MachineBoundMasterKeyProvider · M11 migration', () => {
  const origCwd = process.cwd();
  let tmpCwd: string;

  beforeEach(() => {
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wahubx-mkm-'));
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

  it('migrateLegacyMasterKeyFingerprint · 无 legacy 文件 → 返 false · 不动', () => {
    const migrated = migrateLegacyMasterKeyFingerprint();
    expect(migrated).toBe(false);
  });

  it('legacy master-key-fingerprint.txt 存在且合法 · 新名不存在 → 迁移 · 旧删', () => {
    const legacy = getLegacyFingerprintFilePath();
    const newPath = getFingerprintFilePath();
    const legacyContent = 'a'.repeat(64); // 64 hex (全 a)
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, legacyContent);

    const migrated = migrateLegacyMasterKeyFingerprint();
    expect(migrated).toBe(true);
    expect(fs.existsSync(newPath)).toBe(true);
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.readFileSync(newPath, 'utf-8')).toBe(legacyContent);
  });

  it('legacy 格式非法 → 不迁移 · 保留 legacy 让上层报错引导 recovery', () => {
    const legacy = getLegacyFingerprintFilePath();
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, 'corrupted-not-hex');

    const migrated = migrateLegacyMasterKeyFingerprint();
    expect(migrated).toBe(false);
    expect(fs.existsSync(legacy)).toBe(true); // 保留
  });

  it('新名已存在 · legacy 也在 → 不迁移 · legacy 保留 (provider 用新名)', () => {
    const legacy = getLegacyFingerprintFilePath();
    const newPath = getFingerprintFilePath();
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, 'a'.repeat(64));
    fs.writeFileSync(newPath, 'b'.repeat(64));

    const migrated = migrateLegacyMasterKeyFingerprint();
    expect(migrated).toBe(false); // 新名已在
    expect(fs.readFileSync(newPath, 'utf-8')).toBe('b'.repeat(64)); // 未覆盖
    expect(fs.existsSync(legacy)).toBe(true); // 未删
  });

  it('构造函数触发迁移 · provider.getKey() 稳定', () => {
    // 先造 legacy + 正确 hex
    const legacy = getLegacyFingerprintFilePath();
    const legacyFp = 'c'.repeat(64);
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, legacyFp);

    // new provider 触发迁移
    const p = new MachineBoundMasterKeyProvider();
    expect(p.isFreshInstall()).toBe(false); // 从 legacy 迁出来 · 非 fresh
    expect(p.getKey().length).toBe(32);

    // 新名应该存在, 旧名应已删
    expect(fs.existsSync(getFingerprintFilePath())).toBe(true);
    expect(fs.existsSync(legacy)).toBe(false);
  });
});
