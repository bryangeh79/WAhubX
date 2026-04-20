// M7 Day 2 · Flux text-to-image provider abstraction
//
// 两 backend:
//   - flux-local · 假设用户已起 ComfyUI (port 8188) · HTTP API 调
//   - flux-replicate · Replicate cloud API · 付费 · 约 $0.003/img (flux-dev)
//
// Day 4 AvatarGenerator 一次生 4 候选 · Day 5 StatusPost 按需生 1

export type FluxBackend = 'flux-local' | 'flux-replicate';

export interface FluxGenerateParams {
  /** 英文 prompt · 描述目标图 */
  prompt: string;
  /** 可选 negative prompt · 避开 */
  negative_prompt?: string;
  /** 图宽 · 默认 768 · 支 512/768/1024 */
  width?: number;
  /** 图高 · 同上 */
  height?: number;
  /** 种子 · 复现用 · 不传则随机 */
  seed?: number;
  /** 单批生成张数 · 1-4 · avatar 4 · status 1 */
  count: number;
  /** 审计 · 选填 */
  persona_id?: string;
}

export interface FluxImage {
  /** PNG base64 · no data: prefix */
  base64: string;
  width: number;
  height: number;
  seed: number;
}

export interface FluxGenerateResult {
  images: FluxImage[];
  backend: FluxBackend;
  /** Replicate 才有 · 成本估计 · 分 */
  cost_cents?: number;
  latency_ms: number;
}

export interface FluxHealthResult {
  ok: boolean;
  detail: string;
}

export interface FluxProvider {
  readonly name: FluxBackend;
  generate(params: FluxGenerateParams): Promise<FluxGenerateResult>;
  healthCheck(): Promise<FluxHealthResult>;
}

export const FLUX_PROVIDER_TOKEN = Symbol('FLUX_PROVIDER');
