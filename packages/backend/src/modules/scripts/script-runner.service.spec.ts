// Stub baileys.service (transitively imports ESM @whiskeysockets/baileys — jest/ts-jest can't parse)
jest.mock('../baileys/baileys.service', () => ({
  BaileysService: class {},
}));

import type { Repository } from 'typeorm';
import { ScriptRunnerService } from './script-runner.service';
import type { ScriptEntity } from './script.entity';
import type { RewriteCacheEntity } from './rewrite-cache.entity';
import type { AssetEntity } from './asset.entity';
import type { AccountSlotEntity } from '../slots/account-slot.entity';
import type { WaAccountEntity } from '../slots/wa-account.entity';
import type { BaileysService } from '../baileys/baileys.service';
import type { AiTextService } from '../ai/ai-text.service';
import type { AiSettingsService } from '../ai/ai-settings.service';
import type { RewriteResult } from '../ai/adapters/provider.interface';
import { AdapterErrorCode } from '../ai/adapters/provider.interface';

interface Sent {
  slotId: number;
  recipient: string;
  text: string;
}

function buildRunner(opts: {
  scriptContent: Record<string, unknown>;
  existingCache?: Array<Partial<RewriteCacheEntity>>;
  assets?: Array<Partial<AssetEntity>>;
  minWarmupStage?: number; // M5 gate
  accountWarmupStage?: number | ((id: number) => number);
  // M6 · AI 注入
  aiEnabled?: boolean;
  aiRewrite?: (text: string) => RewriteResult; // 自定义 AI 行为
} = { scriptContent: {} }) {
  const sent: Sent[] = [];
  const cache: Array<Partial<RewriteCacheEntity>> = [...(opts.existingCache ?? [])];
  let cacheSeq = 100;

  const script: Partial<ScriptEntity> = {
    id: 1,
    packId: 1,
    scriptId: 's_test',
    content: opts.scriptContent,
    minWarmupStage: opts.minWarmupStage ?? 0,
    pack: { id: 1, packId: 'p', enabled: true } as ScriptEntity['pack'],
  };
  const stageResolver = typeof opts.accountWarmupStage === 'function'
    ? opts.accountWarmupStage
    : () => (opts.accountWarmupStage ?? 3); // 默认 Mature, 不触发 gate

  const scriptRepo = {
    findOne: async () => script as ScriptEntity,
  } as unknown as Repository<ScriptEntity>;

  const cacheRepo = {
    findOne: async ({ where }: { where: { scriptId: number; turnIndex: number; personaHash: string } }) =>
      cache.find(
        (c) =>
          c.scriptId === where.scriptId &&
          c.turnIndex === where.turnIndex &&
          c.personaHash === where.personaHash,
      ) as RewriteCacheEntity | undefined,
    save: async (e: Partial<RewriteCacheEntity>) => {
      if (!e.id) e.id = ++cacheSeq;
      const idx = cache.findIndex((c) => c.id === e.id);
      if (idx >= 0) cache[idx] = { ...cache[idx], ...e };
      else cache.push(e);
      return e as RewriteCacheEntity;
    },
    create: (partial: Partial<RewriteCacheEntity>) => ({ ...partial }) as RewriteCacheEntity,
  } as unknown as Repository<RewriteCacheEntity>;

  const assetRepo = {
    find: async ({ where: { poolName } }: { where: { poolName: string } }) =>
      (opts.assets ?? []).filter((a) => a.poolName === poolName) as AssetEntity[],
  } as unknown as Repository<AssetEntity>;

  const slotRepo = {
    findOne: async ({ where: { accountId } }: { where: { accountId: number } }) =>
      ({ id: 100 + accountId, accountId }) as AccountSlotEntity,
  } as unknown as Repository<AccountSlotEntity>;

  const accountRepo = {
    findOne: async ({ where: { id } }: { where: { id: number } }) =>
      ({
        id,
        phoneNumber: `6018${id.toString().padStart(7, '0')}`,
        warmupStage: stageResolver(id),
      }) as WaAccountEntity,
  } as unknown as Repository<WaAccountEntity>;

  const baileys = {
    sendText: async (slotId: number, recipient: string, text: string) => {
      sent.push({ slotId, recipient, text });
    },
  } as unknown as BaileysService;

  const aiText = {
    rewrite: async (input: { originalText: string }) =>
      opts.aiRewrite ? opts.aiRewrite(input.originalText) : null,
  } as unknown as AiTextService;
  const aiSettings = {
    isTextEnabled: async () => !!opts.aiEnabled,
  } as unknown as AiSettingsService;

  return {
    service: new ScriptRunnerService(
      scriptRepo,
      cacheRepo,
      assetRepo,
      slotRepo,
      accountRepo,
      baileys,
      aiText,
      aiSettings,
    ),
    sent,
    cache,
  };
}

describe('ScriptRunnerService.run', () => {
  it('executes text turns by picking from content_pool and writes cache', async () => {
    const { service, sent, cache } = buildRunner({
      scriptContent: {
        sessions: [
          {
            name: 'main',
            turns: [
              { turn: 1, role: 'A', type: 'text', content_pool: ['hi', 'hello', 'hey'] },
              { turn: 2, role: 'B', type: 'text', content_pool: ['yo'] },
            ],
          },
        ],
      },
    });

    const result = await service.run({ scriptId: 1, roleAaccountId: 1, roleBaccountId: 2, fastMode: true });

    expect(result.turnsExecuted).toBe(2);
    expect(result.turnsSkipped).toBe(0);
    expect(result.errors).toEqual([]);
    expect(sent).toHaveLength(2);
    expect(['hi', 'hello', 'hey']).toContain(sent[0].text);
    expect(sent[1].text).toBe('yo');
    expect(cache).toHaveLength(2);
    expect(cache[0]?.source).toBe('m4_pool_pick');
    expect(cache[0]?.usedCount).toBe(1);
  });

  it('reuses cached variant on second run (same persona) and bumps used_count', async () => {
    // 第一遍填 cache
    const { service, sent, cache } = buildRunner({
      scriptContent: {
        sessions: [
          {
            name: 'main',
            turns: [{ turn: 1, role: 'A', type: 'text', content_pool: ['one', 'two', 'three'] }],
          },
        ],
      },
    });
    await service.run({ scriptId: 1, roleAaccountId: 1, roleBaccountId: 2, fastMode: true });
    const firstPick = sent[0].text;
    expect(cache).toHaveLength(1);
    expect(cache[0]?.usedCount).toBe(1);

    // 再跑一遍同 persona 同 turn — 必须复用同一条
    await service.run({ scriptId: 1, roleAaccountId: 1, roleBaccountId: 2, fastMode: true });
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toBe(firstPick); // 命中同一 variant
    expect(cache).toHaveLength(1); // 不新增
    expect(cache[0]?.usedCount).toBe(2); // used_count 递增
  });

  it('skips text turn with no content_pool and records skip', async () => {
    const { service, sent } = buildRunner({
      scriptContent: {
        sessions: [
          {
            name: 'main',
            turns: [{ turn: 1, role: 'A', type: 'text', content_pool: [] }],
          },
        ],
      },
    });
    const result = await service.run({ scriptId: 1, roleAaccountId: 1, roleBaccountId: 2, fastMode: true });
    expect(result.turnsExecuted).toBe(0);
    expect(result.turnsSkipped).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it('asset turn with no asset + on_disabled=skip → skipped, no send', async () => {
    const { service, sent } = buildRunner({
      scriptContent: {
        sessions: [
          {
            name: 'main',
            turns: [
              {
                turn: 1,
                role: 'A',
                type: 'voice',
                asset_pool: 'voices_laugh',
                on_disabled: 'skip',
              },
            ],
          },
        ],
      },
      assets: [], // pool 空
    });
    const result = await service.run({ scriptId: 1, roleAaccountId: 1, roleBaccountId: 2, fastMode: true });
    expect(result.turnsExecuted).toBe(0);
    expect(result.turnsSkipped).toBe(1);
    expect(sent).toHaveLength(0);
  });

  it('asset turn with no asset + caption_fallback → sends fallback text', async () => {
    const { service, sent } = buildRunner({
      scriptContent: {
        sessions: [
          {
            name: 'main',
            turns: [
              {
                turn: 1,
                role: 'A',
                type: 'voice',
                asset_pool: 'voices_missing',
                caption_fallback: '哈哈',
                on_disabled: 'send_fallback_text',
              },
            ],
          },
        ],
      },
      assets: [],
    });
    const result = await service.run({ scriptId: 1, roleAaccountId: 1, roleBaccountId: 2, fastMode: true });
    expect(result.turnsExecuted).toBe(1);
    expect(result.turnsSkipped).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toBe('哈哈');
  });

  it('records errors per turn without aborting session', async () => {
    const { service } = buildRunner({
      scriptContent: {
        sessions: [
          {
            name: 'main',
            turns: [
              { turn: 1, role: 'A', type: 'text', content_pool: ['ok'] },
              { turn: 2, role: 'A', type: 'text', content_pool: ['boom'] },
              { turn: 3, role: 'A', type: 'text', content_pool: ['ok2'] },
            ],
          },
        ],
      },
    });
    // 打桩 baileys 让 turn 2 抛
    let call = 0;
    (service as unknown as { baileys: BaileysService }).baileys = {
      sendText: async () => {
        call++;
        if (call === 2) throw new Error('wa session dead');
      },
    } as unknown as BaileysService;

    const result = await service.run({ scriptId: 1, roleAaccountId: 1, roleBaccountId: 2, fastMode: true });
    expect(result.turnsExecuted).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].turn).toBe(2);
    expect(result.errors[0].error).toBe('wa session dead');
  });

  // ── M5 min_warmup_stage gate ─────────────────────────────
  it('rejects run when sender warmupStage < script.minWarmupStage', async () => {
    const { service, sent } = buildRunner({
      scriptContent: {
        sessions: [
          {
            name: 'main',
            turns: [{ turn: 1, role: 'A', type: 'text', content_pool: ['hi'] }],
          },
        ],
      },
      minWarmupStage: 2,
      accountWarmupStage: 0, // 双方都 < 2
    });
    await expect(
      service.run({ scriptId: 1, roleAaccountId: 1, roleBaccountId: 2, fastMode: true }),
    ).rejects.toThrow(/warmup_stage 不足/);
    expect(sent).toHaveLength(0); // 彻底不发
  });

  it('rejects run when only partner (B) is below gate', async () => {
    const { service } = buildRunner({
      scriptContent: {
        sessions: [
          {
            name: 'main',
            turns: [{ turn: 1, role: 'A', type: 'text', content_pool: ['hi'] }],
          },
        ],
      },
      minWarmupStage: 2,
      accountWarmupStage: (id) => (id === 1 ? 3 : 0), // A ok, B 不够
    });
    await expect(
      service.run({ scriptId: 1, roleAaccountId: 1, roleBaccountId: 2, fastMode: true }),
    ).rejects.toThrow(/warmup_stage 不足/);
  });

  it('accepts run when both sides >= minWarmupStage', async () => {
    const { service } = buildRunner({
      scriptContent: {
        sessions: [
          {
            name: 'main',
            turns: [{ turn: 1, role: 'A', type: 'text', content_pool: ['hi'] }],
          },
        ],
      },
      minWarmupStage: 1,
      accountWarmupStage: 1, // 恰好
    });
    const result = await service.run({ scriptId: 1, roleAaccountId: 1, roleBaccountId: 2, fastMode: true });
    expect(result.turnsExecuted).toBe(1);
  });

  it('different personas (different sender accounts) get different cache entries', async () => {
    const { service, cache } = buildRunner({
      scriptContent: {
        sessions: [
          {
            name: 'main',
            turns: [{ turn: 1, role: 'A', type: 'text', content_pool: ['x', 'y', 'z'] }],
          },
        ],
      },
    });
    await service.run({ scriptId: 1, roleAaccountId: 1, roleBaccountId: 2, fastMode: true });
    await service.run({ scriptId: 1, roleAaccountId: 7, roleBaccountId: 2, fastMode: true }); // 不同 A 账号
    expect(cache).toHaveLength(2);
    expect(cache[0]?.personaHash).not.toBe(cache[1]?.personaHash);
  });

  // ── M6 AI rewrite integration ──────────────────────────────
  it('AI disabled → pool pick 原路 (source=m4_pool_pick)', async () => {
    const { service, cache, sent } = buildRunner({
      scriptContent: {
        sessions: [{ name: 'main', turns: [{ turn: 1, role: 'A', type: 'text', content_pool: ['hi'] }] }],
      },
      aiEnabled: false,
    });
    await service.run({ scriptId: 1, roleAaccountId: 1, roleBaccountId: 2, fastMode: true });
    expect(sent[0].text).toBe('hi');
    expect(cache[0]?.source).toBe('m4_pool_pick');
  });

  it('AI enabled + provider ok → 用 AI 文本 · source=provider type', async () => {
    const { service, cache, sent } = buildRunner({
      scriptContent: {
        sessions: [{ name: 'main', turns: [{ turn: 1, role: 'A', type: 'text', content_pool: ['早上好'] }] }],
      },
      aiEnabled: true,
      aiRewrite: () => ({
        ok: true,
        text: '早鸭',
        providerUsed: 'openai_compat',
        modelUsed: 'gpt-4o-mini',
        latencyMs: 120,
      }),
    });
    await service.run({ scriptId: 1, roleAaccountId: 1, roleBaccountId: 2, fastMode: true });
    expect(sent[0].text).toBe('早鸭');
    expect(cache[0]?.source).toBe('openai_compat');
    expect(cache[0]?.variantText).toBe('早鸭');
  });

  it('AI enabled + AUTH_FAILURE → 降级 pool', async () => {
    const { service, cache, sent } = buildRunner({
      scriptContent: {
        sessions: [{ name: 'main', turns: [{ turn: 1, role: 'A', type: 'text', content_pool: ['早上好'] }] }],
      },
      aiEnabled: true,
      aiRewrite: () => ({
        ok: false,
        error: AdapterErrorCode.AuthFailure,
        message: 'HTTP 401',
        providerUsed: 'openai_compat',
        latencyMs: 90,
      }),
    });
    await service.run({ scriptId: 1, roleAaccountId: 1, roleBaccountId: 2, fastMode: true });
    expect(sent[0].text).toBe('早上好'); // 原 pool 文
    expect(cache[0]?.source).toBe('m4_pool_pick');
  });

  it('AI enabled + TIMEOUT → 降级 pool (运行不中断)', async () => {
    const { service, cache } = buildRunner({
      scriptContent: {
        sessions: [{ name: 'main', turns: [{ turn: 1, role: 'A', type: 'text', content_pool: ['a'] }] }],
      },
      aiEnabled: true,
      aiRewrite: () => ({
        ok: false,
        error: AdapterErrorCode.Timeout,
        message: 'aborted',
        providerUsed: 'openai_compat',
        latencyMs: 8000,
      }),
    });
    const result = await service.run({ scriptId: 1, roleAaccountId: 1, roleBaccountId: 2, fastMode: true });
    expect(result.turnsExecuted).toBe(1);
    expect(cache[0]?.source).toBe('m4_pool_pick');
  });

  it('AI enabled + adapter throws → 降级 pool 不传染到 turn 错', async () => {
    const { service, cache } = buildRunner({
      scriptContent: {
        sessions: [{ name: 'main', turns: [{ turn: 1, role: 'A', type: 'text', content_pool: ['a'] }] }],
      },
      aiEnabled: true,
      aiRewrite: () => {
        throw new Error('provider explode');
      },
    });
    const result = await service.run({ scriptId: 1, roleAaccountId: 1, roleBaccountId: 2, fastMode: true });
    expect(result.turnsExecuted).toBe(1);
    expect(result.errors).toHaveLength(0); // AI 异常不进 runner errors
    expect(cache[0]?.source).toBe('m4_pool_pick');
  });

  it('second run after AI miss 命中 cache · 不再调 AI', async () => {
    const aiCalls: string[] = [];
    const { service, cache } = buildRunner({
      scriptContent: {
        sessions: [{ name: 'main', turns: [{ turn: 1, role: 'A', type: 'text', content_pool: ['hi'] }] }],
      },
      aiEnabled: true,
      aiRewrite: (text) => {
        aiCalls.push(text);
        return {
          ok: true,
          text: `rewritten-${aiCalls.length}`,
          providerUsed: 'openai_compat',
          modelUsed: 'x',
          latencyMs: 50,
        };
      },
    });
    await service.run({ scriptId: 1, roleAaccountId: 1, roleBaccountId: 2, fastMode: true });
    await service.run({ scriptId: 1, roleAaccountId: 1, roleBaccountId: 2, fastMode: true });
    expect(aiCalls).toHaveLength(1); // 第二轮命中 cache, 不调 AI
    expect(cache[0]?.usedCount).toBe(2);
  });
});
