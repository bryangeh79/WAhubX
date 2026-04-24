import { Injectable, Logger } from '@nestjs/common';

// 2026-04-24 · 平台兜底 AI · env 里放 platform key
// LLM:       DeepSeek (FAQ 生成, 意图检测, 兜底对话)
// Embedding: OpenAI text-embedding-3-small (向量检索)
//
// env:
//   PLATFORM_DEEPSEEK_API_KEY
//   PLATFORM_DEEPSEEK_BASE_URL (default: https://api.deepseek.com)
//   PLATFORM_DEEPSEEK_MODEL    (default: deepseek-chat)
//   PLATFORM_OPENAI_API_KEY
//   PLATFORM_OPENAI_BASE_URL   (default: https://api.openai.com)
//   PLATFORM_OPENAI_EMBED_MODEL (default: text-embedding-3-small)

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmCallResult {
  ok: boolean;
  text: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
  error?: string;
}

export interface EmbedResult {
  ok: boolean;
  vectors: number[][];
  model: string;
  tokens: number;
  error?: string;
}

@Injectable()
export class PlatformAiService {
  private readonly logger = new Logger(PlatformAiService.name);

  private get deepseekConfig() {
    return {
      apiKey: process.env.PLATFORM_DEEPSEEK_API_KEY ?? '',
      baseUrl: process.env.PLATFORM_DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
      model: process.env.PLATFORM_DEEPSEEK_MODEL ?? 'deepseek-chat',
    };
  }

  private get openaiConfig() {
    return {
      apiKey: process.env.PLATFORM_OPENAI_API_KEY ?? '',
      baseUrl: process.env.PLATFORM_OPENAI_BASE_URL ?? 'https://api.openai.com',
      embedModel: process.env.PLATFORM_OPENAI_EMBED_MODEL ?? 'text-embedding-3-small',
    };
  }

  isLlmAvailable(): boolean {
    return !!this.deepseekConfig.apiKey;
  }

  isEmbedAvailable(): boolean {
    return !!this.openaiConfig.apiKey;
  }

  /**
   * 平台 LLM 调用 (DeepSeek OpenAI-compat)
   * 用于: FAQ 生成 · 意图检测 · 文档摘要 · 保留实体抽取
   */
  async llm(
    messages: ChatMessage[],
    options: { temperature?: number; maxTokens?: number; jsonMode?: boolean } = {},
  ): Promise<LlmCallResult> {
    const cfg = this.deepseekConfig;
    if (!cfg.apiKey) {
      return {
        ok: false,
        text: '',
        promptTokens: 0,
        completionTokens: 0,
        model: cfg.model,
        error: 'PLATFORM_DEEPSEEK_API_KEY not configured',
      };
    }
    try {
      const body: Record<string, unknown> = {
        model: cfg.model,
        messages,
        temperature: options.temperature ?? 0.4,
        max_tokens: options.maxTokens ?? 2048,
      };
      if (options.jsonMode) {
        body.response_format = { type: 'json_object' };
      }
      const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return {
          ok: false,
          text: '',
          promptTokens: 0,
          completionTokens: 0,
          model: cfg.model,
          error: `HTTP ${res.status} · ${errText.slice(0, 200)}`,
        };
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
        model?: string;
      };
      const text = json.choices?.[0]?.message?.content ?? '';
      return {
        ok: true,
        text,
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
        model: json.model ?? cfg.model,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`DeepSeek call failed: ${msg}`);
      return {
        ok: false,
        text: '',
        promptTokens: 0,
        completionTokens: 0,
        model: cfg.model,
        error: msg,
      };
    }
  }

  /**
   * 平台 Embedding (OpenAI text-embedding-3-small · 1536 维)
   */
  async embed(texts: string[]): Promise<EmbedResult> {
    const cfg = this.openaiConfig;
    if (!cfg.apiKey) {
      return {
        ok: false,
        vectors: [],
        model: cfg.embedModel,
        tokens: 0,
        error: 'PLATFORM_OPENAI_API_KEY not configured',
      };
    }
    if (texts.length === 0) {
      return { ok: true, vectors: [], model: cfg.embedModel, tokens: 0 };
    }
    try {
      const res = await fetch(`${cfg.baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.embedModel,
          input: texts,
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return {
          ok: false,
          vectors: [],
          model: cfg.embedModel,
          tokens: 0,
          error: `HTTP ${res.status} · ${errText.slice(0, 200)}`,
        };
      }
      const json = (await res.json()) as {
        data?: Array<{ embedding: number[] }>;
        usage?: { total_tokens?: number };
      };
      const vectors = (json.data ?? []).map((d) => d.embedding);
      return {
        ok: true,
        vectors,
        model: cfg.embedModel,
        tokens: json.usage?.total_tokens ?? 0,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`OpenAI embed failed: ${msg}`);
      return {
        ok: false,
        vectors: [],
        model: cfg.embedModel,
        tokens: 0,
        error: msg,
      };
    }
  }
}
