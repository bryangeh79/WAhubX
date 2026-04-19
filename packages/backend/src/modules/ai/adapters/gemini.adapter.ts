import { Injectable } from '@nestjs/common';
import {
  AdapterErrorCode,
  RewriteAdapter,
  RewriteInput,
  RewriteResult,
} from './provider.interface';

// Gemini adapter — M6 skeleton, 未实装
// 真实装路径: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}
// body: { contents: [{ parts: [{ text }] }], generationConfig: {...} }
// M6 收工不验, 用户如建 gemini provider 会直接拿到 NOT_IMPLEMENTED 错, runner 自动降级 pool
@Injectable()
export class GeminiAdapter implements RewriteAdapter {
  readonly providerType = 'gemini';

  async rewrite(
    _cfg: { baseUrl: string; apiKey: string; model: string },
    _input: RewriteInput,
  ): Promise<RewriteResult> {
    return {
      ok: false,
      error: AdapterErrorCode.NotImplemented,
      message: 'Gemini adapter 未实装 (M6 scope 只 OpenAI-compat · Gemini 留 M6+ 扩展)',
      providerUsed: this.providerType,
      latencyMs: 0,
    };
  }

  async ping(cfg: { baseUrl: string; apiKey: string; model: string }): Promise<RewriteResult> {
    return this.rewrite(cfg, { originalText: 'ping' });
  }
}
