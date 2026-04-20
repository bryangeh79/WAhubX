// M7 Day 5 · PersonaPoolScheduler UT
import type { Repository } from 'typeorm';
import { PersonaPoolScheduler } from './persona-pool.scheduler';
import { PersonaEntity } from './persona.entity';
import { PersonaGeneratorService } from './persona-generator.service';
import { EthnicityMY } from './persona.types';

function buildMockRepo(startCount: number): Repository<PersonaEntity> {
  let count = startCount;
  return {
    count: async () => count,
    _bump: (n: number) => (count += n),
  } as unknown as Repository<PersonaEntity>;
}

function buildMockGen(savedPerCall: number): PersonaGeneratorService {
  return {
    generate: async ({ count }: { count: number }) => {
      const saved = Math.min(count, savedPerCall);
      return {
        requested: count,
        parsed: saved,
        rejectedLeakage: 0,
        rejectedSchema: 0,
        savedIds: Array.from({ length: saved }, (_, i) => `p_mock_${i}`),
        aiProviderUsed: 'mock',
      };
    },
  } as unknown as PersonaGeneratorService;
}

describe('PersonaPoolScheduler', () => {
  it('refillNow · count 已达 20 · 不调 generator', async () => {
    const repo = buildMockRepo(25);
    let genCalled = false;
    const gen = {
      generate: async () => {
        genCalled = true;
        return {} as never;
      },
    } as unknown as PersonaGeneratorService;
    const sched = new PersonaPoolScheduler(repo, gen);
    const result = await sched.refillNow();
    expect(result.saved).toBe(0);
    expect(result.before).toBe(25);
    expect(genCalled).toBe(false);
  });

  it('refillNow · count=5 · 调 generator with needed=15', async () => {
    const repo = buildMockRepo(5);
    const calls: Array<{ count: number; ethnicity: string }> = [];
    const gen = {
      generate: async (p: { count: number; ethnicity: EthnicityMY }) => {
        calls.push({ count: p.count, ethnicity: p.ethnicity });
        (repo as unknown as { _bump: (n: number) => void })._bump(p.count);
        return {
          requested: p.count,
          parsed: p.count,
          rejectedLeakage: 0,
          rejectedSchema: 0,
          savedIds: Array.from({ length: p.count }, (_, i) => `p_mock_${i}`),
          aiProviderUsed: 'mock',
        };
      },
    } as unknown as PersonaGeneratorService;
    const sched = new PersonaPoolScheduler(repo, gen);
    const result = await sched.refillNow(EthnicityMY.ChineseMalaysian);
    expect(calls).toHaveLength(1);
    expect(calls[0].count).toBe(15);
    expect(calls[0].ethnicity).toBe(EthnicityMY.ChineseMalaysian);
    expect(result.saved).toBe(15);
  });

  it('tick · 非 04:00 MY · 不触发', async () => {
    const gen = buildMockGen(5);
    const repo = buildMockRepo(0);
    const sched = new PersonaPoolScheduler(repo, gen);
    // UTC 00:00 = MY 08:00 · 非 04
    const notRefillHour = new Date('2026-04-20T00:00:00Z');
    let genCalled = false;
    (gen as unknown as { generate: () => Promise<unknown> }).generate = async () => {
      genCalled = true;
      return {} as never;
    };
    await sched.tick(notRefillHour);
    expect(genCalled).toBe(false);
  });

  it('tick · 04:00 MY · 同一天只触发 1 次 · 去重', async () => {
    const repo = buildMockRepo(5);
    const calls: number[] = [];
    const gen = {
      generate: async (p: { count: number }) => {
        calls.push(p.count);
        (repo as unknown as { _bump: (n: number) => void })._bump(p.count);
        return {
          requested: p.count,
          parsed: p.count,
          rejectedLeakage: 0,
          rejectedSchema: 0,
          savedIds: Array.from({ length: p.count }, (_, i) => `p_${i}`),
          aiProviderUsed: 'mock',
        };
      },
    } as unknown as PersonaGeneratorService;
    const sched = new PersonaPoolScheduler(repo, gen);
    // MY 04:00 = UTC 20:00 (前一天)
    const my0400 = new Date('2026-04-19T20:00:00Z');
    await sched.tick(my0400);
    expect(calls).toHaveLength(1);
    // 再触一次同一 MY 日 · 跳过
    const my0415 = new Date('2026-04-19T20:15:00Z');
    await sched.tick(my0415);
    expect(calls).toHaveLength(1); // 无变
  });
});
