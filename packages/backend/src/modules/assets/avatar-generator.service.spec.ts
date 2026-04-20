// M7 Day 4 · AvatarGenerator UT
import { AvatarGeneratorService, scoreImage } from './avatar-generator.service';
import type { FluxService } from './flux/flux.service';
import type { PersonaV1 } from './persona.types';
import { EthnicityMY } from './persona.types';

function buildPersona(): PersonaV1 {
  return {
    persona_id: 'avatar_test_01',
    display_name: 'Test',
    wa_nickname: 'T',
    gender: 'female',
    age: 28,
    ethnicity: EthnicityMY.ChineseMalaysian,
    country: 'MY',
    city: 'Petaling Jaya',
    occupation: '测试',
    languages: { primary: 'zh-CN', secondary: [], code_switching: false },
    personality: ['a'],
    speech_habits: {
      sentence_endings: ['a', 'b', 'c'],
      common_phrases: ['a', 'b', 'c'],
      emoji_preference: ['😊', '🙈'],
      typing_style: '短句',
      avg_msg_length: 12,
    },
    interests: ['a', 'b', 'c'],
    activity_schedule: {
      timezone: 'Asia/Kuala_Lumpur',
      wake_up: '08:00',
      sleep: '23:00',
      peak_hours: ['12:00-13:00'],
      work_hours: null,
    },
    avatar_prompt: 'a 28 year old Chinese Malaysian woman casual',
    signature_candidates: ['test'],
    persona_lock: true,
  };
}

/** 大 PNG (> 20KB) · 保证 valid */
function bigBase64(seed: number): string {
  const buf = Buffer.alloc(30 * 1024, seed & 0xff);
  return buf.toString('base64');
}

/** 微小 PNG · < 20KB → 算 invalid */
function tinyBase64(seed: number): string {
  const buf = Buffer.alloc(1024, seed & 0xff);
  return buf.toString('base64');
}

function buildMockFlux(seqRounds: number[][]): FluxService {
  let round = 0;
  return {
    generate: async (_p: { count: number; persona_id?: string }) => {
      const seeds = seqRounds[round++] ?? seqRounds[seqRounds.length - 1];
      return {
        images: seeds.map((s, i) => ({
          base64: s > 0 ? bigBase64(s) : tinyBase64(i + 1),
          width: 768,
          height: 768,
          seed: s,
        })),
        backend: 'flux-local' as const,
        latency_ms: 10,
      };
    },
    resolveProvider: async () => null,
    healthCheck: async () => ({} as never),
  } as unknown as FluxService;
}

describe('AvatarGeneratorService', () => {
  it('第 1 轮有高分 · 选 winner · regenerated=false', async () => {
    // seed % 100 > 0 → valid · 大 seed 高分
    const flux = buildMockFlux([[10, 20, 80, 30]]);
    const svc = new AvatarGeneratorService(flux);
    const result = await svc.generate({ persona: buildPersona() });
    expect(result.regenerated).toBe(false);
    expect(result.fallbackUsed).toBe(false);
    expect(result.winner.image.seed).toBe(80); // 最大 seed
    expect(result.winner.score).toBeGreaterThanOrEqual(0.5);
  });

  it('第 1 轮全 invalid (tiny bytes) · 第 2 轮高分 · regenerated=true · !fallback', async () => {
    const flux = buildMockFlux([
      [0, 0, 0, 0], // 全 tiny
      [50, 60, 70, 80], // 正常
    ]);
    const svc = new AvatarGeneratorService(flux);
    const result = await svc.generate({ persona: buildPersona() });
    expect(result.regenerated).toBe(true);
    expect(result.fallbackUsed).toBe(false);
    expect(result.winner.score).toBeGreaterThanOrEqual(0.5);
  });

  it('2 轮全 invalid · fallback arr[0] · fallbackUsed=true', async () => {
    const flux = buildMockFlux([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    const svc = new AvatarGeneratorService(flux);
    const result = await svc.generate({ persona: buildPersona() });
    expect(result.regenerated).toBe(true);
    expect(result.fallbackUsed).toBe(true);
    expect(result.candidates).toHaveLength(8); // 4+4
    expect(result.winner).toBe(result.candidates[0]);
  });
});

describe('scoreImage', () => {
  it('小图 (< 20KB) · score=0', () => {
    const tiny = { base64: tinyBase64(99), width: 768, height: 768, seed: 99 };
    expect(scoreImage(tiny)).toBe(0);
  });

  it('大图 · score >= 0.5', () => {
    const big = { base64: bigBase64(50), width: 768, height: 768, seed: 50 };
    expect(scoreImage(big)).toBeGreaterThanOrEqual(0.5);
    expect(scoreImage(big)).toBeLessThanOrEqual(1);
  });
});
