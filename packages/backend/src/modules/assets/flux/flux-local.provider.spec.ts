// M7 Day 2 · FluxLocalProvider UT · mock fetch
import { FluxLocalProvider } from './flux-local.provider';

function buildMockFetch(
  responses: Record<string, { status: number; body: unknown | Buffer }>,
): typeof fetch {
  return (async (url: string | URL | Request, _init?: RequestInit) => {
    const u = typeof url === 'string' ? url : url.toString();
    for (const [matcher, resp] of Object.entries(responses)) {
      if (u.includes(matcher)) {
        const isBuf = Buffer.isBuffer(resp.body);
        return {
          ok: resp.status >= 200 && resp.status < 300,
          status: resp.status,
          json: async () => (isBuf ? null : resp.body),
          arrayBuffer: async () => (isBuf ? (resp.body as Buffer).buffer : new ArrayBuffer(0)),
        } as Response;
      }
    }
    throw new Error(`mock fetch unmatched · ${u}`);
  }) as unknown as typeof fetch;
}

describe('FluxLocalProvider', () => {
  it('healthCheck · ComfyUI 在线 · ok=true', async () => {
    const mockFetch = buildMockFetch({
      '/system_stats': { status: 200, body: { system: { cuda: true } } },
    });
    const p = new FluxLocalProvider({ endpoint: 'http://127.0.0.1:8188', fetchImpl: mockFetch });
    const hc = await p.healthCheck();
    expect(hc.ok).toBe(true);
    expect(hc.detail).toContain('online');
  });

  it('healthCheck · ComfyUI 未启 · ok=false · detail 指向文档', async () => {
    const failFetch: typeof fetch = (async () => {
      throw new Error('ECONNREFUSED 127.0.0.1:8188');
    }) as unknown as typeof fetch;
    const p = new FluxLocalProvider({ endpoint: 'http://127.0.0.1:8188', fetchImpl: failFetch });
    const hc = await p.healthCheck();
    expect(hc.ok).toBe(false);
    expect(hc.detail).toMatch(/ECONNREFUSED|未启动|FLUX-LOCAL-SETUP/);
  });
});
