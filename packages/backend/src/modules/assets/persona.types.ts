// M7 Day 1 · PersonaV1 类型 + Zod validator + canonical serialize + hash util
//
// 对齐 §B.6 Persona JSON 完整结构 · 清债 2 · 填 Record<string, unknown> 弱类型
//
// 用法:
//   import { PersonaV1, PersonaV1Schema, canonicalSerializePersona, computePersonaHash } from '...';
//   const parsed = PersonaV1Schema.parse(raw); // throws on invalid
//   const hash = computePersonaHash(parsed);    // stable 16-hex
//
// 设计要点 (ethnicity 调整 2):
//   - EthnicityMY enum 列全 · V1 仅实装 'chinese-malaysian' · 其他抛 NotImplementedInV1
//   - 'malay' **永不实装** (政治/宗教风险 · CHANGELOG Constraint 记录)

import * as crypto from 'node:crypto';
import { z } from 'zod';

// ── ethnicity 枚举 (V1 仅 chinese-malaysian 实装) ──────

/**
 * 马来西亚族群分类 · V1 只生成 chinese-malaysian
 * V1.1+ 评估 indian-malaysian 和 mixed
 * **'malay' 永不实装** · 政治/宗教风险超出产品边界
 */
export const EthnicityMY = {
  ChineseMalaysian: 'chinese-malaysian',
  IndianMalaysian: 'indian-malaysian', // V1 not implemented · throws
  Mixed: 'mixed', // V1 not implemented · throws
  Malay: 'malay', // **永不实装**
} as const;
export type EthnicityMY = (typeof EthnicityMY)[keyof typeof EthnicityMY];

const V1_SUPPORTED_ETHNICITIES: EthnicityMY[] = [EthnicityMY.ChineseMalaysian];

export class EthnicityNotImplementedError extends Error {
  constructor(ethnicity: EthnicityMY) {
    const reason =
      ethnicity === EthnicityMY.Malay
        ? "'malay' 永不实装 · 政治/宗教风险超产品边界"
        : `'${ethnicity}' V1 不实装 · V1.1 评估`;
    super(`EthnicityNotImplementedInV1: ${reason}`);
    this.name = 'EthnicityNotImplementedError';
  }
}

export function assertEthnicityImplementedInV1(ethnicity: EthnicityMY): void {
  if (!V1_SUPPORTED_ETHNICITIES.includes(ethnicity)) {
    throw new EthnicityNotImplementedError(ethnicity);
  }
}

// ── PersonaV1 Zod schema (§B.6 对齐) ─────────────────

export const LanguagesSchema = z.object({
  primary: z.string().min(2), // e.g. 'zh-CN'
  secondary: z.array(z.string()), // ['en', 'ms']
  code_switching: z.boolean(),
});

export const SpeechHabitsSchema = z.object({
  sentence_endings: z.array(z.string()).min(2).max(10),
  common_phrases: z.array(z.string()).min(3).max(12),
  emoji_preference: z.array(z.string()).min(2).max(10),
  typing_style: z.string().min(2),
  avg_msg_length: z.number().int().min(3).max(200),
});

export const ActivityScheduleSchema = z.object({
  timezone: z.string(), // 'Asia/Kuala_Lumpur' 期望
  wake_up: z.string().regex(/^\d{2}:\d{2}$/),
  sleep: z.string().regex(/^\d{2}:\d{2}$/),
  peak_hours: z.array(z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/)),
  work_hours: z.union([z.string(), z.null()]), // null = 自由职业
});

export const PersonaV1Schema = z.object({
  persona_id: z.string().min(5),
  display_name: z.string().min(2).max(50),
  wa_nickname: z.string().min(1).max(30),
  gender: z.enum(['female', 'male']),
  age: z.number().int().min(18).max(80),
  ethnicity: z.enum([
    EthnicityMY.ChineseMalaysian,
    EthnicityMY.IndianMalaysian,
    EthnicityMY.Mixed,
    EthnicityMY.Malay,
  ]),
  country: z.string().length(2), // 'MY'
  city: z.string().min(2),
  occupation: z.string().min(2).max(50),
  languages: LanguagesSchema,
  personality: z.array(z.string()).min(1).max(8),
  speech_habits: SpeechHabitsSchema,
  interests: z.array(z.string()).min(3).max(12),
  activity_schedule: ActivityScheduleSchema,
  avatar_prompt: z.string().min(20),
  signature_candidates: z.array(z.string()).min(1).max(6),
  persona_lock: z.boolean(),
  created_at: z.string().optional(), // ISO · 生成时填
});

export type PersonaV1 = z.infer<typeof PersonaV1Schema>;

// ── Canonical serialize + hash ──────────────────────

/**
 * 递归 sort object keys · 数组顺序保留 · 用于 cross-platform 稳定序列化
 * 同 M11 signing/manifest-codec canonical 设计 · 独立实装避免跨 module 依赖
 */
function sortKeysDeep(v: unknown): unknown {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  const obj = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    out[k] = sortKeysDeep(obj[k]);
  }
  return out;
}

/**
 * 把 persona 序列化为 canonical JSON bytes
 * - sort keys 递归
 * - 紧凑 (无 indent)
 * - UTF-8
 * - 排除 created_at (时间戳不参与 hash · 不同 instance 生成同 persona 应同 hash)
 */
export function canonicalSerializePersona(persona: PersonaV1): Buffer {
  const clone: Record<string, unknown> = { ...(persona as unknown as Record<string, unknown>) };
  delete clone.created_at;
  const canonical = sortKeysDeep(clone);
  return Buffer.from(JSON.stringify(canonical), 'utf-8');
}

/**
 * M7 Day 1 · 债 6 修 · 新 persona_hash 算法
 *   输入: PersonaV1 (不是 accountId!)
 *   输出: SHA-256(canonical(persona)).hex 前 16 字符
 *
 * 稳定性:
 *   - 同 persona 任意时刻任意机器都产相同 hash
 *   - 不同 persona 产不同 hash (SHA-256 抗碰撞)
 *   - persona 字段 re-order 不影响 hash (canonical sort)
 *   - created_at 变不影响 hash (被排除)
 *
 * 用途: rewrite_cache key = {scriptId, turnIndex, personaHash}
 *   · 同 persona 同 script 同 turn → cache hit
 *   · persona 改 → hash 变 → cache miss → 新 variant 重生成
 */
export function computePersonaHash(persona: PersonaV1): string {
  const canonical = canonicalSerializePersona(persona);
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}
