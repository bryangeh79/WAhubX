import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { PackLoaderService, type PackJson } from './pack-loader.service';
import type { ScriptPackEntity } from './script-pack.entity';
import type { ScriptEntity } from './script.entity';

function buildLoader(opts: {
  existingPacks?: Array<{ id: number; packId: string }>;
  existingScripts?: Array<{ packId: number; scriptId: string }>;
} = {}) {
  const packs: Array<Partial<ScriptPackEntity>> = (opts.existingPacks ?? []).map((p) => ({
    id: p.id,
    packId: p.packId,
    version: '0.0.0',
    enabled: true,
  }));
  const scripts: Array<Partial<ScriptEntity>> = (opts.existingScripts ?? []).map((s) => ({
    ...s,
    id: Math.floor(Math.random() * 10000),
  }));
  let packIdSeq = 10;
  let scriptIdSeq = 100;

  const packRepo = {
    findOne: async ({ where: { packId } }: { where: { packId: string } }) =>
      packs.find((p) => p.packId === packId) as ScriptPackEntity | undefined,
    save: async (e: Partial<ScriptPackEntity>) => {
      if (!e.id) e.id = ++packIdSeq;
      const idx = packs.findIndex((p) => p.id === e.id);
      if (idx >= 0) packs[idx] = { ...packs[idx], ...e };
      else packs.push(e);
      return e as ScriptPackEntity;
    },
    create: (partial: Partial<ScriptPackEntity>) => ({ ...partial }) as ScriptPackEntity,
    find: async () => packs as ScriptPackEntity[],
    remove: async () => {},
  } as unknown as Repository<ScriptPackEntity>;

  const scriptRepo = {
    findOne: async ({ where }: { where: { packId: number; scriptId: string } }) =>
      scripts.find((s) => s.packId === where.packId && s.scriptId === where.scriptId) as ScriptEntity | undefined,
    save: async (e: Partial<ScriptEntity>) => {
      if (!e.id) e.id = ++scriptIdSeq;
      const idx = scripts.findIndex((s) => s.id === e.id);
      if (idx >= 0) scripts[idx] = { ...scripts[idx], ...e };
      else scripts.push(e);
      return e as ScriptEntity;
    },
    create: (partial: Partial<ScriptEntity>) => ({ ...partial }) as ScriptEntity,
    find: async ({ where: { packId } }: { where: { packId: number } }) =>
      scripts.filter((s) => s.packId === packId) as ScriptEntity[],
  } as unknown as Repository<ScriptEntity>;

  return { service: new PackLoaderService(packRepo, scriptRepo), packs, scripts };
}

function minimalValidPack(overrides: Partial<PackJson> = {}): PackJson {
  return {
    pack_id: 'test_pack_v1',
    name: 'Test Pack',
    version: '1.0.0',
    language: 'zh',
    country: ['MY'],
    scripts: [
      {
        id: 's001',
        name: 'Test Script',
        category: 'daily',
        total_turns: 2,
        sessions: [{ name: 's', turns: [{ turn: 1, role: 'A', type: 'text', content_pool: ['hi'] }] }],
      },
    ],
    ...overrides,
  };
}

describe('PackLoaderService.validatePack', () => {
  it('accepts a minimal valid pack', async () => {
    const { service } = buildLoader();
    await expect(service.importJson(minimalValidPack())).resolves.toBeDefined();
  });

  it('rejects missing pack_id', async () => {
    const { service } = buildLoader();
    const bad = minimalValidPack() as unknown as Record<string, unknown>;
    delete bad.pack_id;
    await expect(service.importJson(bad as unknown as PackJson)).rejects.toThrow(BadRequestException);
  });

  it('rejects missing version / language / country', async () => {
    const { service } = buildLoader();
    await expect(service.importJson(minimalValidPack({ version: '' } as Partial<PackJson>))).rejects.toThrow(BadRequestException);
    await expect(service.importJson(minimalValidPack({ language: '' } as Partial<PackJson>))).rejects.toThrow(BadRequestException);
    await expect(service.importJson(minimalValidPack({ country: [] }))).rejects.toThrow(BadRequestException);
  });

  it('rejects duplicate script id within pack', async () => {
    const { service } = buildLoader();
    const pack = minimalValidPack({
      scripts: [
        { id: 'same', name: 'A', category: 'x', total_turns: 1, sessions: [{ name: 's', turns: [] }] },
        { id: 'same', name: 'B', category: 'x', total_turns: 1, sessions: [{ name: 's', turns: [] }] },
      ],
    });
    await expect(service.importJson(pack)).rejects.toThrow(ConflictException);
  });
});

describe('PackLoaderService.importJson idempotency', () => {
  it('creates new pack + scripts on first import', async () => {
    const { service, packs, scripts } = buildLoader();
    await service.importJson(minimalValidPack());
    expect(packs).toHaveLength(1);
    expect(scripts).toHaveLength(1);
  });

  it('updates existing pack version and upserts scripts on repeat import', async () => {
    const { service, packs, scripts } = buildLoader();
    await service.importJson(minimalValidPack());
    await service.importJson(minimalValidPack({ version: '2.0.0' }));
    expect(packs).toHaveLength(1);
    expect(packs[0].version).toBe('2.0.0');
    expect(scripts).toHaveLength(1); // 同 id 不新增
  });

  it('adds new scripts when re-importing with extra script', async () => {
    const { service, scripts } = buildLoader();
    await service.importJson(minimalValidPack());
    await service.importJson(
      minimalValidPack({
        scripts: [
          { id: 's001', name: 'Test Script', category: 'daily', total_turns: 2, sessions: [{ name: 's', turns: [] }] },
          { id: 's002', name: 'Second', category: 'daily', total_turns: 1, sessions: [{ name: 's', turns: [] }] },
        ],
      }),
    );
    expect(scripts).toHaveLength(2);
  });
});

describe('PackLoaderService.validateScript', () => {
  it('rejects script with total_turns=0', async () => {
    const { service } = buildLoader();
    const bad = minimalValidPack({
      scripts: [
        { id: 'x', name: 'x', category: 'x', total_turns: 0, sessions: [{ name: 's', turns: [] }] },
      ],
    });
    await expect(service.importJson(bad)).rejects.toThrow(BadRequestException);
  });

  it('rejects script missing sessions array', async () => {
    const { service } = buildLoader();
    const bad = minimalValidPack({
      scripts: [
        { id: 'x', name: 'x', category: 'x', total_turns: 1 } as unknown as PackJson['scripts'][0],
      ],
    });
    await expect(service.importJson(bad)).rejects.toThrow(BadRequestException);
  });
});
