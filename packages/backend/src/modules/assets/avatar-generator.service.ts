// M7 Day 4 · AvatarGenerator · Flux 4 候选 · 评分选 1 · 全低自动 regenerate 1 轮
//
// V1 评分简化:
//   - face_detection (V1.1 · 需 face-api.js 或 OpenCV) → 此处 skip
//   - image_quality: base64 长度 >= threshold (太小的 PNG = 生成失败/blank)
//   - CLIP score (V1.1) → skip
//   - heuristic score: imageValid ? 0.5 + deterministic(seed) * 0.5 : 0
//
// 阈值: score >= 0.5 过关 · 全低 → 再生 1 轮 · 仍全低 → 返 arr[0] 兜底

import { Injectable, Logger } from '@nestjs/common';
import { FluxService } from './flux/flux.service';
import type { FluxImage } from './flux/flux-provider.interface';
import type { PersonaV1 } from './persona.types';

export interface AvatarGenerateInput {
  persona: PersonaV1;
  width?: number;
  height?: number;
  negative_prompt?: string;
}

export interface AvatarCandidate {
  image: FluxImage;
  score: number;
}

export interface AvatarGenerateResult {
  winner: AvatarCandidate;
  candidates: AvatarCandidate[];
  regenerated: boolean;
  fallbackUsed: boolean; // 全低 · 兜底选第 1
}

const MIN_IMAGE_BYTES = 20 * 1024; // 20KB · 低于此 PNG 视为 blank/invalid
const SCORE_THRESHOLD = 0.5;
const CANDIDATES_PER_ROUND = 4;

@Injectable()
export class AvatarGeneratorService {
  private readonly logger = new Logger(AvatarGeneratorService.name);

  constructor(private readonly flux: FluxService) {}

  async generate(input: AvatarGenerateInput): Promise<AvatarGenerateResult> {
    const prompt = input.persona.avatar_prompt;
    const negative =
      input.negative_prompt ??
      'lowres, blurry, distorted, watermark, signature, text, extra limbs';

    const first = await this.generateRound(prompt, negative, input);
    const winner = pickBest(first);
    if (winner.score >= SCORE_THRESHOLD) {
      return {
        winner,
        candidates: first,
        regenerated: false,
        fallbackUsed: false,
      };
    }

    this.logger.warn(
      `avatar all-low · persona=${input.persona.persona_id} · best=${winner.score.toFixed(2)} · regenerating`,
    );
    const second = await this.generateRound(prompt, negative, input);
    const combined = [...first, ...second];
    const secondWinner = pickBest(combined);
    if (secondWinner.score >= SCORE_THRESHOLD) {
      return {
        winner: secondWinner,
        candidates: combined,
        regenerated: true,
        fallbackUsed: false,
      };
    }

    this.logger.warn(
      `avatar 2 轮全低 · fallback arr[0] · persona=${input.persona.persona_id}`,
    );
    return {
      winner: combined[0],
      candidates: combined,
      regenerated: true,
      fallbackUsed: true,
    };
  }

  private async generateRound(
    prompt: string,
    negative: string,
    input: AvatarGenerateInput,
  ): Promise<AvatarCandidate[]> {
    const result = await this.flux.generate({
      prompt,
      negative_prompt: negative,
      width: input.width ?? 768,
      height: input.height ?? 768,
      count: CANDIDATES_PER_ROUND,
      persona_id: input.persona.persona_id,
    });
    return result.images.map((img) => ({
      image: img,
      score: scoreImage(img),
    }));
  }
}

/** V1 简化评分 · base64 长度 + seed 的 deterministic 部分 */
export function scoreImage(img: FluxImage): number {
  const bytes = (img.base64.length * 3) / 4; // base64 → bytes 估
  if (bytes < MIN_IMAGE_BYTES) return 0;
  // image 有效 · 基础 0.5
  // seed 决定的 deterministic 分 (V1.1 替换为 CLIP score)
  const seedComponent = (img.seed % 100) / 200; // 0 ~ 0.495
  return Math.min(1, 0.5 + seedComponent);
}

function pickBest(candidates: AvatarCandidate[]): AvatarCandidate {
  return candidates.reduce((a, b) => (b.score > a.score ? b : a));
}
