// M7 Day 1 · Voice Prompt Template · placeholder (Day 3 填)
//
// ⚠ 腔调约束 (补强 4):
//   Piper zh-CN voice 是大陆腔 (huayan-medium · 北京普通话)
//   3-5s 短语音差异不明显 · >10s 长语音马华听众可听出
//
// V1 策略:
//   - 只生成 **短语音** (3-5s 范围) · avg 4s · max 7s
//   - 文本内容倾向 "笑声/语气词/短句" · 降低腔调暴露
//   - 长语音 (>10s) 通过文字或 fallback text 处理
//
// V1.1 评估:
//   - fine-tune 马华 zh 声音模型 (私有数据集)
//   - 或引入 ElevenLabs 声音克隆 · 付费高质量

import type { PersonaV1 } from '../persona.types';

/** V1 仅支持 Piper 中英双语 · Day 3 adapter 对接 */
export const SUPPORTED_PIPER_MODELS = {
  'zh-CN': 'zh_CN-huayan-medium', // 女声 · 大陆腔 · 28yo 契合
  'en-US': 'en_US-amy-medium',    // 女声 · 美式英语 · 通用
} as const;

/** 语音池类别 · 与 §B.16 voices/zh · voices/en 对齐 */
export const VOICE_POOL_CATEGORIES = [
  'casual_laugh',       // 笑声 · 2-3s
  'interjection',       // 语气词 aiyo / wah / lor · 1-2s
  'short_reply',        // 短回复 · 3-5s
  'greeting',           // 问候 · 早 / 嗨 / 晚安 · 2-3s
  'confirmation',       // 确认 · ok la / can can · 2-3s
] as const;
export type VoicePoolCategory = (typeof VOICE_POOL_CATEGORIES)[number];

/** 每类别的文本池 · Day 3 Piper adapter 从中抽 · 不超 5s */
export const VOICE_TEXT_POOLS: Record<VoicePoolCategory, string[]> = {
  casual_laugh: [
    '哈哈哈哈哈',
    '嘿嘿嘿',
    '噗哈哈',
    '哎呀哈哈',
  ],
  interjection: [
    'aiyo',
    'wah lau',
    'lor la',
    'alamak',
    'dei',
  ],
  short_reply: [
    '好的啦',
    '可以 can can',
    'ok 先这样',
    '等阵先',
    '酱子咯',
  ],
  greeting: [
    '早',
    '嗨早',
    '晚安',
    'dee 夜好',
  ],
  confirmation: [
    'ok la',
    'can can',
    '没问题',
    '算你的',
  ],
};

/**
 * Day 3 · 给 PiperAdapter 调用前生成参数
 * @param persona 决定 voice model (zh vs en)
 * @param category 决定文本池
 *
 * 返 Piper 生成输入: { voiceModel, text, maxDurationSec }
 */
export function buildPiperRequest(persona: PersonaV1, category: VoicePoolCategory): {
  voiceModel: string;
  text: string;
  maxDurationSec: number;
} {
  // Day 3 实装: 按 persona.languages.primary 选 model
  // 当前 placeholder
  const lang = persona.languages.primary.startsWith('zh') ? 'zh-CN' : 'en-US';
  const voiceModel = SUPPORTED_PIPER_MODELS[lang];
  const pool = VOICE_TEXT_POOLS[category];
  const text = pool[Math.floor(Math.random() * pool.length)];
  return {
    voiceModel,
    text,
    maxDurationSec: 5,
  };
}
