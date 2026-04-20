// M7 Day 2 · Flux Service 门面
//
// 按 settings.assets.flux_backend 选后端 · 支 'auto' / 'flux-local' / 'flux-replicate'
// auto 策略:
//   1. 若 GPU 检测通过 (nvidia-smi exit 0) + local healthCheck ok → local
//   2. 否则若 replicate token 已配 → replicate
//   3. 都没 → 返 null provider · generate 抛清晰错
//
// Day 4 AvatarGenerator + Day 5 StatusPost 通过 generate() 调用 · 不关心 backend

import { execSync } from 'node:child_process';
import { Injectable, Logger } from '@nestjs/common';
import {
  FluxBackend,
  FluxGenerateParams,
  FluxGenerateResult,
  FluxHealthResult,
  FluxProvider,
} from './flux-provider.interface';
import { FluxLocalProvider } from './flux-local.provider';
import { FluxReplicateProvider } from './flux-replicate.provider';

export type FluxBackendMode = FluxBackend | 'auto';

export interface FluxServiceConfig {
  mode: FluxBackendMode;
  local: { endpoint: string };
  replicate: { token: string; model?: string };
  /** 测试注入 · 跳过 nvidia-smi */
  gpuDetector?: () => boolean;
  fetchImpl?: typeof fetch;
}

@Injectable()
export class FluxService {
  private readonly logger = new Logger(FluxService.name);
  private readonly local: FluxLocalProvider;
  private readonly replicate: FluxReplicateProvider;
  private readonly mode: FluxBackendMode;
  private readonly gpuDetector: () => boolean;

  constructor(config: FluxServiceConfig) {
    this.mode = config.mode;
    this.local = new FluxLocalProvider({
      endpoint: config.local.endpoint,
      fetchImpl: config.fetchImpl,
    });
    this.replicate = new FluxReplicateProvider({
      token: config.replicate.token,
      model: config.replicate.model,
      fetchImpl: config.fetchImpl,
    });
    this.gpuDetector = config.gpuDetector ?? defaultGpuDetect;
  }

  async resolveProvider(): Promise<FluxProvider | null> {
    if (this.mode === 'flux-local') return this.local;
    if (this.mode === 'flux-replicate') return this.replicate;
    // auto
    if (this.gpuDetector()) {
      const localHc = await this.local.healthCheck();
      if (localHc.ok) return this.local;
      this.logger.warn(`auto · GPU detected but ComfyUI down: ${localHc.detail}`);
    }
    const repHc = await this.replicate.healthCheck();
    if (repHc.ok) return this.replicate;
    this.logger.warn(`auto · Replicate unavailable: ${repHc.detail}`);
    return null;
  }

  async generate(params: FluxGenerateParams): Promise<FluxGenerateResult> {
    const provider = await this.resolveProvider();
    if (!provider) {
      throw new Error(
        'No Flux backend available · 在 Settings 配 ComfyUI endpoint 或 Replicate token',
      );
    }
    return provider.generate(params);
  }

  async healthCheck(): Promise<Record<FluxBackend, FluxHealthResult>> {
    const [localHc, repHc] = await Promise.all([
      this.local.healthCheck(),
      this.replicate.healthCheck(),
    ]);
    return { 'flux-local': localHc, 'flux-replicate': repHc };
  }
}

function defaultGpuDetect(): boolean {
  try {
    execSync('nvidia-smi --query-gpu=name --format=csv,noheader', {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}
