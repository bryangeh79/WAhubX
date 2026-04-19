import { Injectable, Logger } from '@nestjs/common';
import {
  AdapterErrorCode,
  RewriteAdapter,
  RewriteInput,
  RewriteResult,
} from './provider.interface';

// OpenAI-compat adapter · 覆盖 openai / deepseek / custom_openai_compat (ollama, SiliconFlow, OpenRouter, Azure 等)
// 只用 fetch, 不引 OpenAI SDK — 减 4 个依赖 + 绕所有 SDK 版本锁
// 请求格式 = POST {base_url}/chat/completions + Authorization: Bearer {api_key}
//   body: { model, messages: [{role, content}], max_tokens, temperature }
// 响应格式 = { choices: [{message: {content}}], usage: {...} }
// 所有非 200 按 status 映射到 AdapterErrorCode, 用 AbortController 做 timeout
@Injectable()
export class OpenAICompatAdapter implements RewriteAdapter {
  readonly providerType = 'openai_compat';
  private readonly logger = new Logger(OpenAICompatAdapter.name);

  async rewrite(
    cfg: { baseUrl: string; apiKey: string; model: string },
    input: RewriteInput,
  ): Promise<RewriteResult> {
    const systemPrompt = input.personaHint
      ? `你是在 WhatsApp 聊天的自然口语用户. 人设: ${input.personaHint}. 保持原意, 用更自然的口语表达, 不要照抄给定文本, 一句话以内.`
      : '你是在 WhatsApp 聊天的自然口语用户. 保持原意, 用更自然的口语表达, 不要照抄给定文本, 一句话以内.';
    const userPrompt = `改写这句: ${input.originalText}`;

    return this.call(cfg, {
      system: systemPrompt,
      user: userPrompt,
      maxTokens: input.maxTokens ?? 60,
      timeoutMs: input.timeoutMs ?? 8000,
    });
  }

  async ping(cfg: { baseUrl: string; apiKey: string; model: string }): Promise<RewriteResult> {
    return this.call(cfg, {
      system: '',
      user: 'say hi',
      maxTokens: 5,
      timeoutMs: 8000,
    });
  }

  private async call(
    cfg: { baseUrl: string; apiKey: string; model: string },
    req: { system: string; user: string; maxTokens: number; timeoutMs: number },
  ): Promise<RewriteResult> {
    const started = Date.now();
    const messages: Array<{ role: string; content: string }> = [];
    if (req.system) messages.push({ role: 'system', content: req.system });
    messages.push({ role: 'user', content: req.user });

    const body = JSON.stringify({
      model: cfg.model,
      messages,
      max_tokens: req.maxTokens,
      temperature: 0.8,
    });

    const url = this.joinUrl(cfg.baseUrl, '/chat/completions');
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), req.timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body,
        signal: controller.signal,
      });
      const latencyMs = Date.now() - started;

      if (!res.ok) {
        const errText = await this.safeReadText(res);
        // 日志用脱敏 url (去 query), 绝不打 body/headers
        this.logger.warn(`provider call failed · ${res.status} · ${this.hostOnly(url)} · ${errText.slice(0, 100)}`);
        return {
          ok: false,
          error: this.statusToCode(res.status),
          message: `HTTP ${res.status}: ${errText.slice(0, 180)}`,
          providerUsed: this.providerType,
          latencyMs,
        };
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = data.choices?.[0]?.message?.content?.trim() ?? '';
      if (!text) {
        return {
          ok: false,
          error: AdapterErrorCode.EmptyResult,
          message: 'provider 返回空字符串',
          providerUsed: this.providerType,
          latencyMs,
        };
      }
      return {
        ok: true,
        text,
        providerUsed: this.providerType,
        modelUsed: cfg.model,
        latencyMs,
      };
    } catch (err) {
      const latencyMs = Date.now() - started;
      const aborted = err instanceof Error && err.name === 'AbortError';
      return {
        ok: false,
        error: aborted ? AdapterErrorCode.Timeout : AdapterErrorCode.NetworkError,
        message: err instanceof Error ? err.message.slice(0, 180) : String(err),
        providerUsed: this.providerType,
        latencyMs,
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private statusToCode(status: number): AdapterErrorCode {
    if (status === 401 || status === 403) return AdapterErrorCode.AuthFailure;
    if (status === 429) return AdapterErrorCode.QuotaExceeded;
    if (status >= 500) return AdapterErrorCode.BadResponse;
    return AdapterErrorCode.BadResponse;
  }

  private joinUrl(base: string, path: string): string {
    return `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private hostOnly(url: string): string {
    try {
      const u = new URL(url);
      return `${u.host}${u.pathname}`;
    } catch {
      return '[unparseable-url]';
    }
  }

  private async safeReadText(res: Response): Promise<string> {
    try {
      return await res.text();
    } catch {
      return '(unable to read response body)';
    }
  }
}
