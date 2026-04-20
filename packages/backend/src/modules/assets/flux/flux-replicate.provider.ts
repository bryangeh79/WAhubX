// M7 Day 2 · Flux Replicate provider
//
// Replicate API · POST /v1/predictions · Token Auth
// Model default: black-forest-labs/flux-dev (可配)
// 成本估计: ~$0.003/img · record to result.cost_cents
// 2 次 retry · 指数 backoff (2s / 6s) · 防 503

import { Injectable } from '@nestjs/common';
import {
  FluxBackend,
  FluxGenerateParams,
  FluxGenerateResult,
  FluxHealthResult,
  FluxImage,
  FluxProvider,
} from './flux-provider.interface';

export interface FluxReplicateConfig {
  token: string;
  model?: string; // 'black-forest-labs/flux-dev'
  apiBase?: string; // 'https://api.replicate.com/v1'
  pollIntervalMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_MODEL = 'black-forest-labs/flux-dev';
const DEFAULT_API_BASE = 'https://api.replicate.com/v1';
const COST_CENTS_PER_IMG = 0.3; // ~$0.003 (flux-dev)

@Injectable()
export class FluxReplicateProvider implements FluxProvider {
  readonly name: FluxBackend = 'flux-replicate';
  private readonly token: string;
  private readonly model: string;
  private readonly apiBase: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly doFetch: typeof fetch;

  constructor(config: FluxReplicateConfig) {
    this.token = config.token;
    this.model = config.model ?? DEFAULT_MODEL;
    this.apiBase = (config.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, '');
    this.pollIntervalMs = config.pollIntervalMs ?? 2000;
    this.timeoutMs = config.timeoutMs ?? 180000;
    this.doFetch = config.fetchImpl ?? (globalThis.fetch as typeof fetch);
  }

  async healthCheck(): Promise<FluxHealthResult> {
    if (!this.token) return { ok: false, detail: 'Replicate token 未配' };
    try {
      const resp = await this.doFetch(`${this.apiBase}/account`, {
        headers: { Authorization: `Token ${this.token}` },
      });
      if (!resp.ok) return { ok: false, detail: `HTTP ${resp.status}` };
      return { ok: true, detail: 'Replicate reachable' };
    } catch (err) {
      return {
        ok: false,
        detail: `Replicate 无法连接 · ${err instanceof Error ? err.message : err}`,
      };
    }
  }

  async generate(params: FluxGenerateParams): Promise<FluxGenerateResult> {
    if (!this.token) throw new Error('Replicate token 未配 · 先在 Settings UI 填');
    const started = Date.now();
    const width = params.width ?? 768;
    const height = params.height ?? 768;
    const images: FluxImage[] = [];

    for (let i = 0; i < params.count; i++) {
      const seed = params.seed ?? Math.floor(Math.random() * 2 ** 31);
      const input = {
        prompt: params.prompt,
        negative_prompt: params.negative_prompt ?? '',
        width,
        height,
        seed,
        num_inference_steps: 28,
      };
      const predId = await this.createPredictionWithRetry(input);
      const outputUrl = await this.pollPrediction(predId);
      const imgResp = await this.doFetch(outputUrl);
      if (!imgResp.ok) throw new Error(`Replicate output fetch HTTP ${imgResp.status}`);
      const buf = Buffer.from(await imgResp.arrayBuffer());
      images.push({
        base64: buf.toString('base64'),
        width,
        height,
        seed,
      });
    }

    return {
      images,
      backend: this.name,
      cost_cents: Math.round(COST_CENTS_PER_IMG * images.length * 10) / 10,
      latency_ms: Date.now() - started,
    };
  }

  private async createPredictionWithRetry(
    input: Record<string, unknown>,
  ): Promise<string> {
    const backoffs = [0, 2000, 6000]; // 3 attempts
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < backoffs.length; attempt++) {
      if (backoffs[attempt] > 0) await new Promise((r) => setTimeout(r, backoffs[attempt]));
      try {
        const resp = await this.doFetch(`${this.apiBase}/predictions`, {
          method: 'POST',
          headers: {
            Authorization: `Token ${this.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ version: this.model, input }),
        });
        if (resp.status === 503 || resp.status === 429) {
          lastErr = new Error(`Replicate HTTP ${resp.status} (retryable)`);
          continue;
        }
        if (!resp.ok) throw new Error(`Replicate HTTP ${resp.status}`);
        const body = (await resp.json()) as { id: string };
        return body.id;
      } catch (err) {
        lastErr = err;
        if (attempt === backoffs.length - 1) throw err;
      }
    }
    throw lastErr ?? new Error('Replicate create prediction 全失败');
  }

  private async pollPrediction(predId: string): Promise<string> {
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      const resp = await this.doFetch(`${this.apiBase}/predictions/${predId}`, {
        headers: { Authorization: `Token ${this.token}` },
      });
      if (resp.ok) {
        const body = (await resp.json()) as {
          status: string;
          output?: string | string[];
          error?: string | null;
        };
        if (body.status === 'succeeded') {
          const out = Array.isArray(body.output) ? body.output[0] : body.output;
          if (!out) throw new Error(`Replicate ${predId} 无 output`);
          return out;
        }
        if (body.status === 'failed' || body.status === 'canceled') {
          throw new Error(`Replicate ${predId} ${body.status}: ${body.error ?? 'unknown'}`);
        }
      }
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
    throw new Error(`Replicate polling timeout · id=${predId}`);
  }
}
