// M10 · backup-paths 纯工具测试

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { listDailyDates, listDailySlotZips, todayISO } from './backup-paths';

describe('backup-paths', () => {
  const origCwd = process.cwd();
  let tmpCwd: string;

  beforeEach(() => {
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'wahubx-paths-'));
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

  it('todayISO · 本地时区 YYYY-MM-DD 格式', () => {
    const result = todayISO(new Date('2026-04-20T10:30:00'));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('listDailyDates · 过滤非日期目录 · 按日期升序', () => {
    const root = path.join(tmpCwd, 'data', 'backups', 'daily');
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(path.join(root, '2026-04-19'));
    fs.mkdirSync(path.join(root, '2026-04-20'));
    fs.mkdirSync(path.join(root, 'garbage-dir'));
    fs.mkdirSync(path.join(root, '2025-12-31'));
    const dates = listDailyDates();
    expect(dates).toEqual(['2025-12-31', '2026-04-19', '2026-04-20']);
  });

  it('listDailySlotZips · 只列 slot_NN.zip · 按 slotIndex 升序', () => {
    const dir = path.join(tmpCwd, 'data', 'backups', 'daily', '2026-04-20');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'slot_01.zip'), 'x');
    fs.writeFileSync(path.join(dir, 'slot_11.zip'), 'xxx');
    fs.writeFileSync(path.join(dir, 'slot_02.zip'), 'xx');
    fs.writeFileSync(path.join(dir, 'garbage.txt'), 'ignored');
    const list = listDailySlotZips('2026-04-20');
    expect(list.map((x) => x.slotIndex)).toEqual([1, 2, 11]);
    expect(list[0].sizeBytes).toBe(1);
    expect(list[1].sizeBytes).toBe(2);
  });
});
