// M7 Day 4 · AssetService UT
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Repository } from 'typeorm';
import { AssetService } from './asset.service';
import { AssetEntity, AssetKind, AssetSource } from '../scripts/asset.entity';

function buildMockRepo(): {
  repo: Repository<AssetEntity>;
  store: AssetEntity[];
} {
  const store: AssetEntity[] = [];
  let seq = 1;
  const repo = {
    create: (p: Partial<AssetEntity>) => ({ ...p }) as AssetEntity,
    save: async (e: AssetEntity) => {
      if (!e.id) e.id = seq++;
      const idx = store.findIndex((x) => x.id === e.id);
      if (idx >= 0) store[idx] = e;
      else store.push(e);
      return e;
    },
    findOne: async ({ where }: { where: Record<string, unknown> }) =>
      store.find((a) =>
        Object.entries(where).every(([k, v]) => (a as unknown as Record<string, unknown>)[k] === v),
      ) ?? null,
    find: async ({ where, take }: { where: Record<string, unknown>; take?: number }) =>
      store
        .filter((a) =>
          Object.entries(where).every(([k, v]) => (a as unknown as Record<string, unknown>)[k] === v),
        )
        .slice(0, take ?? 50),
    count: async ({ where }: { where: Record<string, unknown> }) =>
      store.filter((a) =>
        Object.entries(where).every(([k, v]) => (a as unknown as Record<string, unknown>)[k] === v),
      ).length,
    remove: async (e: AssetEntity) => {
      const idx = store.findIndex((x) => x.id === e.id);
      if (idx >= 0) store.splice(idx, 1);
      return e;
    },
    createQueryBuilder: () => {
      const state: { params: Record<string, unknown> } = { params: {} };
      const qb = {
        where: (_: string, params: Record<string, unknown>) => {
          state.params = params;
          return qb;
        },
        limit: () => qb,
        getMany: async () =>
          store.filter(
            (a) =>
              a.kind === state.params.kind &&
              a.poolName === state.params.pool &&
              a.personaId === null,
          ),
      };
      return qb;
    },
  } as unknown as Repository<AssetEntity>;
  return { repo, store };
}

describe('AssetService', () => {
  let tmpDataDir: string;
  const origEnv = process.env.WAHUBX_DATA_DIR;

  beforeAll(() => {
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wahubx-asset-spec-'));
    process.env.WAHUBX_DATA_DIR = tmpDataDir;
  });

  afterAll(() => {
    if (origEnv === undefined) delete process.env.WAHUBX_DATA_DIR;
    else process.env.WAHUBX_DATA_DIR = origEnv;
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
  });

  it('create · 落盘 + DB 插入 · file_path 用 forward slash', async () => {
    const { repo, store } = buildMockRepo();
    const svc = new AssetService(repo);
    const asset = await svc.create({
      kind: AssetKind.Image,
      poolName: 'food',
      filename: 'test_001.jpg',
      buffer: Buffer.from('fake-png-bytes'),
      source: AssetSource.AiGenerated,
      personaId: 'persona_x',
    });
    expect(asset.id).toBe(1);
    expect(asset.filePath).toBe('assets/image/food/test_001.jpg');
    expect(asset.personaId).toBe('persona_x');
    expect(fs.existsSync(path.join(tmpDataDir, 'assets/image/food/test_001.jpg'))).toBe(true);
    expect(store).toHaveLength(1);
  });

  it('countByPersonaAndKind · 按 persona + kind 计数', async () => {
    const { repo } = buildMockRepo();
    const svc = new AssetService(repo);
    await svc.create({
      kind: AssetKind.Image,
      poolName: 'food',
      filename: 'p1_001.jpg',
      buffer: Buffer.from('x'),
      source: AssetSource.AiGenerated,
      personaId: 'p1',
    });
    await svc.create({
      kind: AssetKind.Image,
      poolName: 'food',
      filename: 'p1_002.jpg',
      buffer: Buffer.from('x'),
      source: AssetSource.AiGenerated,
      personaId: 'p1',
    });
    await svc.create({
      kind: AssetKind.Voice,
      poolName: 'greeting',
      filename: 'p1_001.wav',
      buffer: Buffer.from('x'),
      source: AssetSource.AiGenerated,
      personaId: 'p1',
    });
    expect(await svc.countByPersonaAndKind('p1', AssetKind.Image)).toBe(2);
    expect(await svc.countByPersonaAndKind('p1', AssetKind.Voice)).toBe(1);
    expect(await svc.countByPersonaAndKind('p1', AssetKind.File)).toBe(0);
  });

  it('delete · DB + 磁盘文件 · 缺文件不抛', async () => {
    const { repo, store } = buildMockRepo();
    const svc = new AssetService(repo);
    const asset = await svc.create({
      kind: AssetKind.Image,
      poolName: 'food',
      filename: 'del_001.jpg',
      buffer: Buffer.from('x'),
      source: AssetSource.AiGenerated,
    });
    expect(await svc.delete(asset.id)).toBe(true);
    expect(store).toHaveLength(0);

    // 再删 · 应返 false (找不到)
    expect(await svc.delete(asset.id)).toBe(false);
  });
});
