// M7 Day 1 #10 · storage path helpers UT
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import {
  getAssetsDir,
  getAssetPoolDir,
  getBuiltinAssetPoolDir,
  getAssetFilePath,
  toAssetRelativePath,
} from './storage';

describe('storage · M7 asset path helpers', () => {
  let tmpDataDir: string;
  const origEnv = process.env.WAHUBX_DATA_DIR;

  beforeAll(() => {
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wahubx-storage-spec-'));
    process.env.WAHUBX_DATA_DIR = tmpDataDir;
  });

  afterAll(() => {
    if (origEnv === undefined) delete process.env.WAHUBX_DATA_DIR;
    else process.env.WAHUBX_DATA_DIR = origEnv;
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
  });

  it('getAssetsDir · data/assets · 自动创建', () => {
    const dir = getAssetsDir();
    expect(dir).toBe(path.join(tmpDataDir, 'assets'));
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('getAssetPoolDir · data/assets/<kind>/<pool>', () => {
    const dir = getAssetPoolDir('voices', 'casual_laugh');
    expect(dir).toBe(path.join(tmpDataDir, 'assets', 'voices', 'casual_laugh'));
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('getBuiltinAssetPoolDir · _builtin 下 · 不自动创建 (installer 装后才有)', () => {
    const dir = getBuiltinAssetPoolDir('voices', 'casual_laugh');
    expect(dir).toBe(path.join(tmpDataDir, 'assets', '_builtin', 'voices', 'casual_laugh'));
    // 不 ensureDir · 消费方自查
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('getAssetFilePath · 拼 filename', () => {
    const p = getAssetFilePath('images', 'food_malaysian', 'nasi_lemak_001.jpg');
    expect(p).toBe(
      path.join(tmpDataDir, 'assets', 'images', 'food_malaysian', 'nasi_lemak_001.jpg'),
    );
  });

  it('toAssetRelativePath · 强 forward slash · 跨平台一致', () => {
    const rel = toAssetRelativePath('voices', 'greeting', '001.ogg');
    expect(rel).toBe('assets/voices/greeting/001.ogg');
    expect(rel).not.toContain('\\');
  });
});
