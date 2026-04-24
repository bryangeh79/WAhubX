import { Injectable, Logger } from '@nestjs/common';
import {
  AdapterErrorCode,
  RewriteAdapter,
  RewriteInput,
  RewriteResult,
} from './provider.interface';

// Gemini adapter · 2026-04-24 实装
// API: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}
// Body: { contents: [{ parts: [{ text }] }], generationConfig: { maxOutputTokens, temperature } }
// Response: { candidates: [{ content: { parts: [{ text }] } }] }
// 注: Gemini 把 key 放 URL query, 不在 Authorization header
@Injectable()
export class GeminiAdapter implements RewriteAdapter {
  readonly providerType = 'gemini';
  private readonly logger = new Logger(GeminiAdapter.name);

  async rewrite(
    cfg: { baseUrl: string; apiKey: string; model: string },
    input: RewriteInput,
  ): Promise<RewriteResult> {
    const systemPrompt =
      input.systemPromptOverride ??
      (input.personaHint
        ? `你是在 WhatsApp 聊天的自然口语用户. 人设: ${input.personaHint}. 保持原意, 用更自然的口语表达, 不要照抄给定文本, 一句话以内.`
        : '你是在 WhatsApp 聊天的自然口语用户. 保持原意, 用更自然的口语表达, 不要照抄给定文本, 一句话以内.');
    const userPrompt = input.userPromptOverride ?? `改写这句: ${input.originalText}`;
    return this.call(cfg, {
      prompt: `${systemPrompt}\n\n${userPrompt}`,
      maxTokens: input.maxTokens ?? 60,
      timeoutMs: input.timeoutMs ?? 8000,
    });
  }

  async ping(cfg: { baseUrl: string; apiKey: string; model: string }): Promise<RewriteResult> {
    return this.call(cfg, { prompt: 'say hi in one short sentence', maxTokens: 5, timeoutMs: 8000 });
  }

  private async call(
    cfg: { baseUrl: string; apiKey: string; model: string },
    req: { prompt: string; maxTokens: number; timeoutMs: number },
  ): Promise<RewriteResult> {
    const started = Date.now();
    const base = (cfg.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
    const url = `${base}/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;

    const body = JSON.stringify({
      contents: [{ parts: [{ text: req.prompt }] }],
      generationConfig: {
        maxOutputTokens: req.maxTokens,
        temperature: 0.8,
      },
    });

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), req.timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      const latencyMs = Date.now() - started;

      if (!res.ok) {
        const errText = await this.safeReadText(res);
        this.logger.warn(
          `gemini call failed · ${res.status} · ${this.hostPath(url)} · ${errText.slice(0, 100)}`,
        );
        return {
          ok: false,
          error: this.statusToCode(res.status),
          message: `HTTP ${res.status}: ${errText.slice(0, 180)}`,
          providerUsed: this.providerType,
          latencyMs,
        };
      }

      const data = (await res.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
          finishReason?: string;
        }>;
      };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? '';
      if (!text) {
        return {
          ok: false,
          error: AdapterErrorCode.EmptyResult,
          message: 'Gemini 返回空字符串',
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

  private hostPath(url: string): string {
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
