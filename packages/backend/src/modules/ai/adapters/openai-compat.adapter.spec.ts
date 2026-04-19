import { OpenAICompatAdapter } from './openai-compat.adapter';
import { AdapterErrorCode } from './provider.interface';

function mockFetch(response: { status: number; body: unknown; delayMs?: number }) {
  return jest.fn(async (_url: string, init: RequestInit) => {
    if (response.delayMs) await new Promise((r) => setTimeout(r, response.delayMs));
    if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body,
      text: async () => JSON.stringify(response.body),
    } as unknown as Response;
  });
}

describe('OpenAICompatAdapter', () => {
  const cfg = { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini' };

  it('maps 200 → ok with returned content + latency', async () => {
    global.fetch = mockFetch({
      status: 200,
      body: { choices: [{ message: { content: '  早安!  ' } }] },
    }) as unknown as typeof fetch;
    const adapter = new OpenAICompatAdapter();
    const res = await adapter.rewrite(cfg, { originalText: '早上好' });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.text).toBe('早安!');
      expect(res.providerUsed).toBe('openai_compat');
      expect(res.modelUsed).toBe('gpt-4o-mini');
      expect(res.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('maps 401 → AUTH_FAILURE', async () => {
    global.fetch = mockFetch({
      status: 401,
      body: { error: { message: 'invalid api key' } },
    }) as unknown as typeof fetch;
    const res = await new OpenAICompatAdapter().rewrite(cfg, { originalText: 'x' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe(AdapterErrorCode.AuthFailure);
  });

  it('maps 429 → QUOTA_EXCEEDED', async () => {
    global.fetch = mockFetch({ status: 429, body: {} }) as unknown as typeof fetch;
    const res = await new OpenAICompatAdapter().rewrite(cfg, { originalText: 'x' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe(AdapterErrorCode.QuotaExceeded);
  });

  it('maps 500 → BAD_RESPONSE', async () => {
    global.fetch = mockFetch({ status: 503, body: {} }) as unknown as typeof fetch;
    const res = await new OpenAICompatAdapter().rewrite(cfg, { originalText: 'x' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe(AdapterErrorCode.BadResponse);
  });

  it('maps empty content → EMPTY_RESULT', async () => {
    global.fetch = mockFetch({
      status: 200,
      body: { choices: [{ message: { content: '' } }] },
    }) as unknown as typeof fetch;
    const res = await new OpenAICompatAdapter().rewrite(cfg, { originalText: 'x' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe(AdapterErrorCode.EmptyResult);
  });

  it('maps abort → TIMEOUT', async () => {
    // 让 fetch 慢于 timeoutMs 触发 AbortController
    global.fetch = jest.fn(async (_url, init: RequestInit) => {
      await new Promise<void>((resolve, reject) => {
        const listener = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        init.signal?.addEventListener('abort', listener);
        setTimeout(() => resolve(), 2000);
      });
      return {} as Response;
    }) as unknown as typeof fetch;
    const res = await new OpenAICompatAdapter().rewrite(cfg, { originalText: 'x', timeoutMs: 50 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe(AdapterErrorCode.Timeout);
  });
});
