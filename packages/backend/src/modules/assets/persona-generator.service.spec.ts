// M7 Day 4 · PersonaGeneratorService UT
import type { Repository } from 'typeorm';
import { PersonaGeneratorService } from './persona-generator.service';
import { PersonaEntity } from './persona.entity';
import { EthnicityMY, type PersonaV1 } from './persona.types';
import type { AiTextService } from '../ai/ai-text.service';
import { AdapterErrorCode, type RewriteResult } from '../ai/adapters/provider.interface';

function validPersonaFixture(id: string, extras: Partial<PersonaV1> = {}): PersonaV1 {
  return {
    persona_id: id,
    display_name: 'Test Persona',
    wa_nickname: 'T',
    gender: 'female',
    age: 28,
    ethnicity: EthnicityMY.ChineseMalaysian,
    country: 'MY',
    city: 'Petaling Jaya',
    occupation: '电商客服',
    languages: { primary: 'zh-CN', secondary: ['en'], code_switching: true },
    personality: ['开朗'],
    speech_habits: {
      sentence_endings: ['lah', 'lor', '啦'],
      common_phrases: ['真的吗 la', '我 kena 啦', 'aiyo'],
      emoji_preference: ['😊', '🙈'],
      typing_style: '短句',
      avg_msg_length: 12,
    },
    interests: ['吃 mamak', 'K-pop', '找 cafe'],
    activity_schedule: {
      timezone: 'Asia/Kuala_Lumpur',
      wake_up: '08:30',
      sleep: '23:30',
      peak_hours: ['12:00-13:30'],
      work_hours: '09:30-18:30',
    },
    avatar_prompt: '28yo Chinese Malaysian woman in PJ cafe',
    signature_candidates: ['吃饱没'],
    persona_lock: true,
    ...extras,
  };
}

function buildMockRepo(): { repo: Repository<PersonaEntity>; store: PersonaEntity[] } {
  const store: PersonaEntity[] = [];
  const repo = {
    create: (p: Partial<PersonaEntity>) => ({ ...p }) as PersonaEntity,
    save: async (e: PersonaEntity) => {
      store.push(e);
      return e;
    },
  } as unknown as Repository<PersonaEntity>;
  return { repo, store };
}

function buildMockAi(rewriteFn: () => RewriteResult): AiTextService {
  return {
    rewrite: async () => rewriteFn(),
  } as unknown as AiTextService;
}

describe('PersonaGeneratorService', () => {
  it('AI 返 2 条合法 persona · 全部 saved', async () => {
    const { repo, store } = buildMockRepo();
    const pA = validPersonaFixture('persona_gen_a_01');
    const pB = validPersonaFixture('persona_gen_b_02', { display_name: 'Amy', age: 32 });
    const ai = buildMockAi(() => ({
      ok: true,
      text: JSON.stringify([pA, pB]),
      providerUsed: 'mock_provider',
      modelUsed: 'mock-m',
      latencyMs: 10,
    }));
    const svc = new PersonaGeneratorService(repo, ai);
    const report = await svc.generate({ count: 2, ethnicity: EthnicityMY.ChineseMalaysian });
    expect(report.parsed).toBe(2);
    expect(report.savedIds).toHaveLength(2);
    expect(report.rejectedSchema).toBe(0);
    expect(report.rejectedLeakage).toBe(0);
    expect(store).toHaveLength(2);
    expect(report.aiProviderUsed).toBe('mock_provider');
  });

  it('AI 返 persona 含 "yyds" · leakage 拒绝 · 不 save', async () => {
    const { repo, store } = buildMockRepo();
    const leaky = validPersonaFixture('persona_leak_01', {
      speech_habits: {
        sentence_endings: ['lah', 'lor', '啦'],
        common_phrases: ['yyds 好棒', '真的吗', '我 kena 啦'],
        emoji_preference: ['😊', '🙈'],
        typing_style: '短句',
        avg_msg_length: 12,
      },
    });
    const ai = buildMockAi(() => ({
      ok: true,
      text: JSON.stringify([leaky]),
      providerUsed: 'mock',
      modelUsed: 'm',
      latencyMs: 5,
    }));
    const svc = new PersonaGeneratorService(repo, ai);
    const report = await svc.generate({ count: 1, ethnicity: EthnicityMY.ChineseMalaysian });
    expect(report.rejectedLeakage).toBe(1);
    expect(report.savedIds).toHaveLength(0);
    expect(store).toHaveLength(0);
  });

  it('AI 失败 · 返 0 saved · 不抛', async () => {
    const { repo } = buildMockRepo();
    const ai = buildMockAi(() => ({
      ok: false,
      error: AdapterErrorCode.AuthFailure,
      message: '401',
      providerUsed: 'mock',
      latencyMs: 3,
    }));
    const svc = new PersonaGeneratorService(repo, ai);
    const report = await svc.generate({ count: 3, ethnicity: EthnicityMY.ChineseMalaysian });
    expect(report.savedIds).toHaveLength(0);
    expect(report.parsed).toBe(0);
  });
});
