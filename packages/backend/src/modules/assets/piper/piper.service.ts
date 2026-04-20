// M7 Day 3 · Piper TTS service 门面
//
// 职责:
//   - 按 persona.languages.primary 选 model (zh_CN → huayan · 默认 en_US → amy)
//   - 从 VOICE_TEXT_POOLS 抽文本 · 限 8s (长语音腔调露馅 · 补强 4)
//   - 调用 PiperAdapter 生 wav · 返 path
//
// 文本 → 秒数估算: 中文 ~4 字/秒 · 英文 ~3 词/秒 · 粗算不超则发

import { Injectable } from '@nestjs/common';
import { PiperAdapter } from './piper-adapter';
import type { PersonaV1 } from '../persona.types';
import {
  SUPPORTED_PIPER_MODELS,
  VOICE_TEXT_POOLS,
  type VoicePoolCategory,
} from '../prompts/voice-prompts';

const MAX_SEC = 8; // V1 上限 · 补强 4

export interface PiperGenerateInput {
  persona: PersonaV1;
  category: VoicePoolCategory;
  /** 强制文本 · 跳过 pool 抽签 · 仍走长度校验 */
  overrideText?: string;
  /** wav 目标路径 · 调用方决定 */
  outputPath: string;
  /** 模型目录 · 默认 process.env.PIPER_MODELS_DIR 或 './models' */
  modelsDir?: string;
}

export interface PiperGenerateOutput {
  text: string;
  wavPath: string;
  estimatedSec: number;
  modelUsed: string;
}

@Injectable()
export class PiperService {
  constructor(private readonly adapter: PiperAdapter) {}

  async generate(input: PiperGenerateInput): Promise<PiperGenerateOutput> {
    const text = input.overrideText ?? this.pickText(input.category);
    const estimatedSec = estimateDurationSec(text);
    if (estimatedSec > MAX_SEC) {
      throw new Error(
        `文本预估 ${estimatedSec.toFixed(1)}s 超 ${MAX_SEC}s 上限 (V1 · 补强 4) · 改短或降 category`,
      );
    }

    const modelName = this.selectModel(input.persona);
    const modelsDir = input.modelsDir ?? process.env.PIPER_MODELS_DIR ?? './models';
    const modelPath = `${modelsDir}/${modelName}.onnx`;

    const result = await this.adapter.generate({
      text,
      modelPath,
      outputPath: input.outputPath,
      timeoutSec: 30,
    });
    if (result.code !== 0) {
      const stderr = result.stderr.toString('utf-8').slice(0, 500);
      throw new Error(`piper exit=${result.code} · stderr: ${stderr}`);
    }

    return {
      text,
      wavPath: input.outputPath,
      estimatedSec,
      modelUsed: modelName,
    };
  }

  selectModel(persona: PersonaV1): string {
    const lang = persona.languages.primary;
    if (lang.startsWith('zh')) return SUPPORTED_PIPER_MODELS['zh-CN'];
    return SUPPORTED_PIPER_MODELS['en-US'];
  }

  pickText(category: VoicePoolCategory): string {
    const pool = VOICE_TEXT_POOLS[category];
    if (!pool || pool.length === 0) {
      throw new Error(`voice pool 为空 · category=${category}`);
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }
}

/** 估算: 中文 4 字/秒 · 英文 3 词/秒 · 混合按字符 2.5/秒 */
export function estimateDurationSec(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const nonChinese = text.length - chineseChars;
  // 粗算 · overcount 宁可保守
  return chineseChars / 4 + nonChinese / 8 + 0.5;
}
