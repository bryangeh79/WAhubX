// M7 Day 2 · FluxReplicateProvider UT · mock fetch
import { FluxReplicateProvider } from './flux-replicate.provider';

describe('FluxReplicateProvider', () => {
  it('healthCheck · token 空 · 返 "token 未配"', async () => {
    const p = new FluxReplicateProvider({
      token: '',
      fetchImpl: (async () => {
        throw new Error('should not be called');
      }) as unknown as typeof fetch,
    });
    const hc = await p.healthCheck();
    expect(hc.ok).toBe(false);
    expect(hc.detail).toContain('token 未配');
  });

  it('healthCheck · token OK · /account 200 · ok=true', async () => {
    const mockFetch = (async (url: string | URL | Request) => {
      const u = typeof url === 'string' ? url : url.toString();
      expect(u).toContain('/account');
      return {
        ok: true,
        status: 200,
        json: async () => ({ type: 'user' }),
      } as Response;
    }) as unknown as typeof fetch;
    const p = new FluxReplicateProvider({ token: 'r8_test', fetchImpl: mockFetch });
    const hc = await p.healthCheck();
    expect(hc.ok).toBe(true);
    expect(hc.detail).toContain('reachable');
  });
});
