// M7 Day 1 · PersonaV1 types + hash UT

import {
  EthnicityMY,
  EthnicityNotImplementedError,
  PersonaV1Schema,
  assertEthnicityImplementedInV1,
  canonicalSerializePersona,
  computePersonaHash,
  type PersonaV1,
} from './persona.types';
import { buildPersonaGenPrompt, detectMainlandLeakage } from './prompts/persona-zh-my';

// ── Fixture ──────────────────────────────────────────
function validPersona(overrides: Partial<PersonaV1> = {}): PersonaV1 {
  return {
    persona_id: 'persona_fixture_01',
    display_name: 'Jasmine Chen',
    wa_nickname: 'Jas 🌸',
    gender: 'female',
    age: 28,
    ethnicity: EthnicityMY.ChineseMalaysian,
    country: 'MY',
    city: 'Petaling Jaya',
    occupation: '电商客服',
    languages: {
      primary: 'zh-CN',
      secondary: ['en', 'ms'],
      code_switching: true,
    },
    personality: ['开朗', '碎碎念'],
    speech_habits: {
      sentence_endings: ['lah', '啦', 'lor'],
      common_phrases: ['真的吗 la', '我 kena 啦', 'aiyo'],
      emoji_preference: ['😊', '🙈', '😋'],
      typing_style: '短句 + 偶尔错字',
      avg_msg_length: 12,
    },
    interests: ['吃 mamak', '美妆 haul', 'K-pop', '咖啡'],
    activity_schedule: {
      timezone: 'Asia/Kuala_Lumpur',
      wake_up: '08:30',
      sleep: '23:30',
      peak_hours: ['12:00-13:30', '19:00-22:30'],
      work_hours: '09:30-18:30',
    },
    avatar_prompt: '28-year-old Chinese Malaysian woman, casual in PJ cafe',
    signature_candidates: ['吃饱没 🍜'],
    persona_lock: true,
    ...overrides,
  };
}

// ── Schema validation ────────────────────────────────
describe('PersonaV1Schema', () => {
  it('合法 persona 过校验', () => {
    expect(() => PersonaV1Schema.parse(validPersona())).not.toThrow();
  });

  it('缺必填字段 · 抛', () => {
    const bad = { ...validPersona() } as Partial<PersonaV1>;
    delete (bad as { persona_id?: string }).persona_id;
    expect(() => PersonaV1Schema.parse(bad)).toThrow();
  });

  it('ethnicity 枚举外值 · 抛', () => {
    expect(() =>
      PersonaV1Schema.parse({ ...validPersona(), ethnicity: 'white-american' as never }),
    ).toThrow();
  });

  it('sentence_endings < 2 · 抛', () => {
    const bad = validPersona({
      speech_habits: { ...validPersona().speech_habits, sentence_endings: ['lah'] },
    });
    expect(() => PersonaV1Schema.parse(bad)).toThrow();
  });

  it('avg_msg_length 超界 · 抛', () => {
    const bad = validPersona({
      speech_habits: { ...validPersona().speech_habits, avg_msg_length: 500 },
    });
    expect(() => PersonaV1Schema.parse(bad)).toThrow();
  });
});

// ── Ethnicity V1 守护 ────────────────────────────────
describe('EthnicityMY · V1 守护', () => {
  it('chinese-malaysian · 通过', () => {
    expect(() => assertEthnicityImplementedInV1(EthnicityMY.ChineseMalaysian)).not.toThrow();
  });

  it('malay · 抛 · 永不实装说明', () => {
    try {
      assertEthnicityImplementedInV1(EthnicityMY.Malay);
      fail('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EthnicityNotImplementedError);
      expect((err as Error).message).toContain('永不实装');
    }
  });

  it('indian-malaysian · 抛 · V1 not implemented', () => {
    try {
      assertEthnicityImplementedInV1(EthnicityMY.IndianMalaysian);
      fail('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(EthnicityNotImplementedError);
      expect((err as Error).message).toContain('V1 不实装');
    }
  });

  it('mixed · 抛 V1 not implemented', () => {
    expect(() => assertEthnicityImplementedInV1(EthnicityMY.Mixed)).toThrow(
      EthnicityNotImplementedError,
    );
  });
});

// ── Canonical serialize ──────────────────────────────
describe('canonicalSerializePersona', () => {
  it('相同 persona 产相同 bytes', () => {
    const p = validPersona();
    const a = canonicalSerializePersona(p);
    const b = canonicalSerializePersona(p);
    expect(a.equals(b)).toBe(true);
  });

  it('key 顺序不同 · 仍产相同 bytes (canonical sort)', () => {
    const p1 = validPersona();
    // 构造 key 顺序打乱的等价 persona (通过 JSON 重建顺序)
    const reshuffled = JSON.parse(
      JSON.stringify({
        persona_lock: p1.persona_lock,
        ethnicity: p1.ethnicity,
        persona_id: p1.persona_id,
        display_name: p1.display_name,
        wa_nickname: p1.wa_nickname,
        gender: p1.gender,
        age: p1.age,
        country: p1.country,
        city: p1.city,
        occupation: p1.occupation,
        languages: p1.languages,
        personality: p1.personality,
        speech_habits: p1.speech_habits,
        interests: p1.interests,
        activity_schedule: p1.activity_schedule,
        avatar_prompt: p1.avatar_prompt,
        signature_candidates: p1.signature_candidates,
      }),
    ) as PersonaV1;
    expect(canonicalSerializePersona(p1).equals(canonicalSerializePersona(reshuffled))).toBe(true);
  });

  it('created_at 字段变化 · hash 不变 (被排除)', () => {
    const p1 = validPersona();
    const p2 = validPersona();
    (p1 as { created_at?: string }).created_at = '2026-04-20T00:00:00Z';
    (p2 as { created_at?: string }).created_at = '2027-01-01T00:00:00Z';
    expect(canonicalSerializePersona(p1).equals(canonicalSerializePersona(p2))).toBe(true);
  });
});

// ── computePersonaHash · M7 Day 1 #5 ─────────────────
describe('computePersonaHash · 清债 6', () => {
  it('同 persona 稳定 hash', () => {
    const p = validPersona();
    const h1 = computePersonaHash(p);
    const h2 = computePersonaHash(p);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
  });

  it('不同 persona · 不同 hash', () => {
    const p1 = validPersona();
    const p2 = validPersona({ persona_id: 'persona_different_02', display_name: 'Amy Tan' });
    expect(computePersonaHash(p1)).not.toBe(computePersonaHash(p2));
  });

  it('同 persona + 变 created_at · 同 hash (created_at 被排除)', () => {
    const p1 = validPersona();
    const p2 = validPersona();
    (p1 as { created_at?: string }).created_at = '2026-04-20T00:00:00Z';
    expect(computePersonaHash(p1)).toBe(computePersonaHash(p2));
  });
});

// ── persona-zh-my.ts · prompt 生成 + anti-leakage ────
describe('persona-zh-my · prompt + leakage detection', () => {
  it('buildPersonaGenPrompt · chinese-malaysian · 通过 · prompt 含必要硬约束', () => {
    const prompt = buildPersonaGenPrompt({
      count: 5,
      ethnicity: EthnicityMY.ChineseMalaysian,
    });
    expect(prompt).toContain('chinese-malaysian');
    expect(prompt).toContain('sentence_endings');
    expect(prompt).toContain('Asia/Kuala_Lumpur');
    expect(prompt).toContain('绝绝子'); // 禁止列表举例
    expect(prompt).toContain('mamak');
  });

  it('buildPersonaGenPrompt · malay · 抛 · 永不实装', () => {
    expect(() =>
      buildPersonaGenPrompt({ count: 5, ethnicity: EthnicityMY.Malay }),
    ).toThrow(EthnicityNotImplementedError);
  });

  it('detectMainlandLeakage · 含 "yyds" 检测到', () => {
    const p = validPersona({
      speech_habits: {
        ...validPersona().speech_habits,
        common_phrases: ['yyds 好棒', '真的吗 la', '我 kena 啦'],
      },
    });
    const leaked = detectMainlandLeakage(p);
    expect(leaked).toContain('yyds');
  });

  it('detectMainlandLeakage · 含 "北京" 检测到', () => {
    const p = validPersona({ city: '北京' as never });
    const leaked = detectMainlandLeakage(p);
    expect(leaked).toContain('北京');
  });

  it('detectMainlandLeakage · 纯正马华 persona · 无 leakage', () => {
    const p = validPersona();
    const leaked = detectMainlandLeakage(p);
    expect(leaked).toHaveLength(0);
  });
});
