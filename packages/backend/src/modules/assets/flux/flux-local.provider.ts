// M7 Day 2 · Flux local (ComfyUI) provider
//
// 设计:
//   - 用户本地装 ComfyUI · 默认 :8188 · WAhubX 通过 HTTP 调
//   - workflow 模板 · V1 hard-code 在 buildWorkflow · Day 7 seed 可覆盖到 data/flux-workflows/
//   - POST /prompt 提交 · 返 { prompt_id }
//   - 轮询 GET /history/<prompt_id> 到 outputs.images 填 · 默认 poll 1s · 超时 120s
//   - GET /view?filename=... 拉 PNG binary · base64 之
//
// 不做 (V1.1):
//   - LoRA / ControlNet
//   - spawn ComfyUI 进程 (假设用户已起)
//   - flux-schnell (仅 flux-dev default)

import { Injectable } from '@nestjs/common';
import {
  FLUX_PROVIDER_TOKEN,
  FluxBackend,
  FluxGenerateParams,
  FluxGenerateResult,
  FluxHealthResult,
  FluxImage,
  FluxProvider,
} from './flux-provider.interface';

export interface FluxLocalConfig {
  endpoint: string; // 'http://127.0.0.1:8188'
  pollIntervalMs?: number; // default 1000
  timeoutMs?: number; // default 120000
  /** 注入 fetch · 测试 mock */
  fetchImpl?: typeof fetch;
}

@Injectable()
export class FluxLocalProvider implements FluxProvider {
  readonly name: FluxBackend = 'flux-local';
  private readonly endpoint: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly doFetch: typeof fetch;

  constructor(config: FluxLocalConfig) {
    this.endpoint = config.endpoint.replace(/\/$/, '');
    this.pollIntervalMs = config.pollIntervalMs ?? 1000;
    this.timeoutMs = config.timeoutMs ?? 120000;
    this.doFetch = config.fetchImpl ?? (globalThis.fetch as typeof fetch);
  }

  async healthCheck(): Promise<FluxHealthResult> {
    try {
      const resp = await this.doFetch(`${this.endpoint}/system_stats`);
      if (!resp.ok) return { ok: false, detail: `HTTP ${resp.status}` };
      const body = (await resp.json()) as { system?: unknown };
      if (!body.system) return { ok: false, detail: '响应缺 system 字段' };
      return { ok: true, detail: 'ComfyUI online' };
    } catch (err) {
      return {
        ok: false,
        detail: `ComfyUI 未启动 · 见 docs/FLUX-LOCAL-SETUP.md · ${err instanceof Error ? err.message : err}`,
      };
    }
  }

  async generate(params: FluxGenerateParams): Promise<FluxGenerateResult> {
    const started = Date.now();
    const width = params.width ?? 768;
    const height = params.height ?? 768;
    const images: FluxImage[] = [];

    for (let i = 0; i < params.count; i++) {
      const seed = params.seed ?? Math.floor(Math.random() * 2 ** 31);
      const workflow = this.buildWorkflow({ ...params, width, height, seed });
      const promptResp = await this.doFetch(`${this.endpoint}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: workflow }),
      });
      if (!promptResp.ok) {
        throw new Error(`ComfyUI prompt submit HTTP ${promptResp.status}`);
      }
      const { prompt_id } = (await promptResp.json()) as { prompt_id: string };

      // 轮询 history
      const filename = await this.pollHistory(prompt_id);
      // 拉 PNG
      const viewResp = await this.doFetch(
        `${this.endpoint}/view?filename=${encodeURIComponent(filename)}`,
      );
      if (!viewResp.ok) throw new Error(`ComfyUI view HTTP ${viewResp.status}`);
      const buf = Buffer.from(await viewResp.arrayBuffer());
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
      latency_ms: Date.now() - started,
    };
  }

  private async pollHistory(promptId: string): Promise<string> {
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      const resp = await this.doFetch(`${this.endpoint}/history/${promptId}`);
      if (resp.ok) {
        const body = (await resp.json()) as Record<
          string,
          { outputs?: Record<string, { images?: Array<{ filename: string }> }> }
        >;
        const entry = body[promptId];
        if (entry?.outputs) {
          for (const out of Object.values(entry.outputs)) {
            if (out.images?.[0]?.filename) return out.images[0].filename;
          }
        }
      }
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
    throw new Error(`ComfyUI generation timeout · prompt_id=${promptId}`);
  }

  private buildWorkflow(p: FluxGenerateParams & { width: number; height: number; seed: number }): unknown {
    // Minimal flux-dev workflow · ComfyUI 原生节点
    // Day 7 可覆盖 · 当前 hard-code 求稳
    return {
      '3': {
        class_type: 'KSampler',
        inputs: {
          seed: p.seed,
          steps: 20,
          cfg: 1.0,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 1,
          model: ['4', 0],
          positive: ['6', 0],
          negative: ['7', 0],
          latent_image: ['5', 0],
        },
      },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'flux1-dev.safetensors' } },
      '5': {
        class_type: 'EmptyLatentImage',
        inputs: { width: p.width, height: p.height, batch_size: 1 },
      },
      '6': {
        class_type: 'CLIPTextEncode',
        inputs: { text: p.prompt, clip: ['4', 1] },
      },
      '7': {
        class_type: 'CLIPTextEncode',
        inputs: { text: p.negative_prompt ?? '', clip: ['4', 1] },
      },
      '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
      '9': { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: 'wahubx' } },
    };
  }
}

export { FLUX_PROVIDER_TOKEN };
