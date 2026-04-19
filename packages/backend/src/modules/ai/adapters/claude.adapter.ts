import { Injectable } from '@nestjs/common';
import {
  AdapterErrorCode,
  RewriteAdapter,
  RewriteInput,
  RewriteResult,
} from './provider.interface';

// Claude (Anthropic) adapter — M6 skeleton, 未实装
// 真实装路径: POST {base_url}/messages
//   headers: x-api-key, anthropic-version: 2023-06-01
//   body: { model, max_tokens, messages: [{role: 'user', content}] }
@Injectable()
export class ClaudeAdapter implements RewriteAdapter {
  readonly providerType = 'claude';

  async rewrite(
    _cfg: { baseUrl: string; apiKey: string; model: string },
    _input: RewriteInput,
  ): Promise<RewriteResult> {
    return {
      ok: false,
      error: AdapterErrorCode.NotImplemented,
      message: 'Claude adapter 未实装 (M6 scope 只 OpenAI-compat · Claude 留 M6+ 扩展)',
      providerUsed: this.providerType,
      latencyMs: 0,
    };
  }

  async ping(cfg: { baseUrl: string; apiKey: string; model: string }): Promise<RewriteResult> {
    return this.rewrite(cfg, { originalText: 'ping' });
  }
}
