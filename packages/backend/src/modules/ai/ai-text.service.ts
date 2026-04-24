import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiProviderEntity, AiProviderType } from './ai-provider.entity';
import { AiEncryptionService } from './ai-encryption.service';
import { OpenAICompatAdapter } from './adapters/openai-compat.adapter';
import { GeminiAdapter } from './adapters/gemini.adapter';
import { ClaudeAdapter } from './adapters/claude.adapter';
import {
  RewriteAdapter,
  RewriteInput,
  RewriteResult,
} from './adapters/provider.interface';

// AI 文本改写 service
//   rewrite() 被 ScriptRunnerService.resolveText miss 分支调用
//   若返 ok=true → runner 落 rewrite_cache source=<providerType>
//   若返 ok=false → runner 自动降级 m4_pool_pick (fallback 保证剧本可跑)
//
// enabled 判定优先级:
//   1. DB ai_setting 'text_enabled' row (runtime 动态切换)
//   2. env AI_TEXT_ENABLED (冷启动默认)
// M6 只读 1 + 2 (不做缓存失效 ttl), 实装方见 AiSettingsService.
@Injectable()
export class AiTextService {
  private readonly logger = new Logger(AiTextService.name);

  constructor(
    private readonly encryption: AiEncryptionService,
    @InjectRepository(AiProviderEntity) private readonly providerRepo: Repository<AiProviderEntity>,
    private readonly openAiCompat: OpenAICompatAdapter,
    private readonly gemini: GeminiAdapter,
    private readonly claude: ClaudeAdapter,
  ) {}

  /**
   * 跑 rewrite — 检查开关 + 选当前 enabled provider + 调 adapter + 返结果.
   * ScriptRunnerService 收到 ok=false 任意 code 都走 pool fallback, 不 throw.
   */
  async rewrite(input: RewriteInput, enabled: boolean): Promise<RewriteResult | null> {
    if (!enabled) return null; // runner 看 null 直接走 pool, 不记日志降低噪音
    const provider = await this.pickActiveProvider();
    if (!provider) {
      this.logger.debug('no enabled provider, skipping AI rewrite');
      return null;
    }

    const adapter = this.adapterFor(provider.providerType);
    const apiKey = this.decryptKey(provider);
    const result = await adapter.rewrite(
      { baseUrl: provider.baseUrl, apiKey, model: provider.model },
      input,
    );
    // 日志只带 providerType + latency + ok, 永远不打 key / response body
    this.logger.log(
      `rewrite · type=${provider.providerType} · model=${provider.model} · ok=${result.ok} · ${result.latencyMs}ms${result.ok ? '' : ` · err=${result.error}`}`,
    );
    return result;
  }

  /**
   * 连通性测试 — 发最小 ping 请求, 更新 last_tested_at + last_test_ok.
   */
  async test(providerId: number): Promise<RewriteResult> {
    const provider = await this.providerRepo.findOne({ where: { id: providerId } });
    if (!provider) throw new Error(`ai_provider ${providerId} 不存在`);
    const adapter = this.adapterFor(provider.providerType);
    const apiKey = this.decryptKey(provider);
    const result = await adapter.ping({ baseUrl: provider.baseUrl, apiKey, model: provider.model });
    provider.lastTestedAt = new Date();
    provider.lastTestOk = result.ok;
    provider.lastTestError = result.ok ? null : result.message.slice(0, 200);
    await this.providerRepo.save(provider);
    return result;
  }

  // ── helpers ─────────────────────────────────────────────
  /**
   * 2026-04-24 · 运行时对话生成 · 用租户配置的 active provider
   * 智能客服自动回复跑这个 · 不走平台兜底 key (成本由租户承担)
   */
  async chatWithTenant(options: {
    systemPrompt: string;
    userPrompt: string;
    maxTokens?: number;
    timeoutMs?: number;
  }): Promise<{
    ok: boolean;
    text: string;
    model: string;
    providerType: string;
    errorCode?: string;
    errorMessage?: string;
  }> {
    const provider = await this.pickActiveProvider();
    if (!provider) {
      return {
        ok: false,
        text: '',
        model: '',
        providerType: '',
        errorCode: 'NO_PROVIDER',
        errorMessage: '租户未配置 AI provider',
      };
    }
    const adapter = this.adapterFor(provider.providerType);
    let apiKey: string;
    try {
      apiKey = this.decryptKey(provider);
    } catch (err) {
      return {
        ok: false,
        text: '',
        model: provider.model,
        providerType: provider.providerType,
        errorCode: 'DECRYPT_FAIL',
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
    const result = await adapter.rewrite(
      { baseUrl: provider.baseUrl, apiKey, model: provider.model },
      {
        originalText: '',
        systemPromptOverride: options.systemPrompt,
        userPromptOverride: options.userPrompt,
        maxTokens: options.maxTokens ?? 512,
        timeoutMs: options.timeoutMs ?? 30_000,
      },
    );
    if (result.ok) {
      this.logger.log(
        `chatWithTenant · ${provider.providerType} · ${provider.model} · ${result.latencyMs}ms`,
      );
      return {
        ok: true,
        text: result.text,
        model: result.modelUsed,
        providerType: provider.providerType,
      };
    }
    this.logger.warn(
      `chatWithTenant fail · ${provider.providerType} · ${result.error} · ${result.message}`,
    );
    return {
      ok: false,
      text: '',
      model: provider.model,
      providerType: provider.providerType,
      errorCode: result.error,
      errorMessage: result.message,
    };
  }

  private async pickActiveProvider(): Promise<AiProviderEntity | null> {
    // 取第一条 enabled 的 provider. 多条候选时 id 最小的胜出.
    // 未来扩: 按 persona.language / cost 策略选 (V1.1+).
    return this.providerRepo.findOne({ where: { enabled: true }, order: { id: 'ASC' } });
  }

  private adapterFor(type: AiProviderType): RewriteAdapter {
    switch (type) {
      case AiProviderType.OpenAI:
      case AiProviderType.DeepSeek:
      case AiProviderType.CustomOpenAICompat:
        return this.openAiCompat;
      case AiProviderType.Gemini:
        return this.gemini;
      case AiProviderType.Claude:
        return this.claude;
      default: {
        const _exhaustive: never = type;
        throw new Error(`unknown provider type: ${_exhaustive as string}`);
      }
    }
  }

  private decryptKey(provider: AiProviderEntity): string {
    try {
      return this.encryption.decrypt(provider.apiKeyEncrypted);
    } catch (err) {
      // 不泄漏 key 密文任何部分
      throw new Error(
        `无法解密 ai_provider ${provider.id} 的 api_key · master key 可能已轮换或损坏`,
      );
    }
  }
}
