// M11 Preamble · machine-id.util 旧名 → 新名迁移测试

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getMachineId } from './machine-id.util';

describe('machine-id.util · M11 fp-license migration', () => {
  const origCwd = process.cwd();
  let tmpCwd: string;

  beforeEach(() => {
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wahubx-mid-'));
    process.chdir(tmpCwd);
    delete process.env.WAHUBX_MACHINE_ID_FILE;
  });

  afterEach(() => {
    process.chdir(origCwd);
    try {
      fs.rmSync(tmpCwd, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('首次调用 · 生成新名 fp-license.txt · 不碰 legacy 路径', () => {
    const id = getMachineId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    const newPath = path.join(tmpCwd, 'data', 'config', 'fp-license.txt');
    const legacy = path.join(tmpCwd, 'data', 'config', 'machine-fingerprint.txt');
    expect(fs.existsSync(newPath)).toBe(true);
    expect(fs.existsSync(legacy)).toBe(false);
    expect(fs.readFileSync(newPath, 'utf-8')).toBe(id);
  });

  it('M10→M11 迁移 · legacy 文件存在 + 新名不在 → 自动 rename · 旧名删 · ID 不变', () => {
    // 预置 legacy file
    const legacy = path.join(tmpCwd, 'data', 'config', 'machine-fingerprint.txt');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    const legacyId = 'aabb1234567890abcdef1234567890ab'; // 32 hex
    fs.writeFileSync(legacy, legacyId);

    // 调 getMachineId → 触发迁移
    const id = getMachineId();
    expect(id).toBe(legacyId); // 复用 legacy 值, 不重算

    const newPath = path.join(tmpCwd, 'data', 'config', 'fp-license.txt');
    expect(fs.existsSync(newPath)).toBe(true);
    expect(fs.existsSync(legacy)).toBe(false); // legacy 已删
    expect(fs.readFileSync(newPath, 'utf-8')).toBe(legacyId);
  });

  it('legacy 格式非法 · 不迁移 · 保留 legacy · 新名重新计算', () => {
    const legacy = path.join(tmpCwd, 'data', 'config', 'machine-fingerprint.txt');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, 'not-a-valid-hex-garbage');

    const id = getMachineId();
    expect(id).toMatch(/^[0-9a-f]{32}$/); // 新鲜计算

    const newPath = path.join(tmpCwd, 'data', 'config', 'fp-license.txt');
    expect(fs.existsSync(newPath)).toBe(true);
    expect(fs.existsSync(legacy)).toBe(true); // legacy 保留 (人工检查)
  });

  it('新名已存在 · legacy 也存在 → 不覆盖新名 · legacy 保留', () => {
    const legacy = path.join(tmpCwd, 'data', 'config', 'machine-fingerprint.txt');
    const newPath = path.join(tmpCwd, 'data', 'config', 'fp-license.txt');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, 'aabb1234567890abcdef1234567890ab');
    fs.writeFileSync(newPath, 'ccdd1234567890abcdef1234567890ab');

    const id = getMachineId();
    expect(id).toBe('ccdd1234567890abcdef1234567890ab'); // 用 new
    expect(fs.readFileSync(newPath, 'utf-8')).toBe('ccdd1234567890abcdef1234567890ab');
    expect(fs.existsSync(legacy)).toBe(true); // legacy 未被主动删 · 人工收尾
  });
});
