// M7 Day 2 · FluxService UT · auto backend selection
import { FluxService } from './flux.service';

function mockFetchOk(response: unknown): typeof fetch {
  return (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => response,
    }) as Response) as unknown as typeof fetch;
}

function mockFetchFail(): typeof fetch {
  return (async () => {
    throw new Error('network down');
  }) as unknown as typeof fetch;
}

describe('FluxService', () => {
  it('mode=flux-local · 显式选 · 不跑 gpu detect', async () => {
    let gpuCalled = false;
    const svc = new FluxService({
      mode: 'flux-local',
      local: { endpoint: 'http://127.0.0.1:8188' },
      replicate: { token: 'r8_test' },
      gpuDetector: () => {
        gpuCalled = true;
        return true;
      },
      fetchImpl: mockFetchOk({ system: {} }),
    });
    const provider = await svc.resolveProvider();
    expect(provider?.name).toBe('flux-local');
    expect(gpuCalled).toBe(false);
  });

  it('mode=flux-replicate · 显式选 · 走 replicate 不 heaalth', async () => {
    const svc = new FluxService({
      mode: 'flux-replicate',
      local: { endpoint: 'http://127.0.0.1:8188' },
      replicate: { token: 'r8_test' },
      gpuDetector: () => false,
      fetchImpl: mockFetchFail(),
    });
    const provider = await svc.resolveProvider();
    expect(provider?.name).toBe('flux-replicate');
  });

  it('mode=auto · 有 GPU + local ok → local', async () => {
    const svc = new FluxService({
      mode: 'auto',
      local: { endpoint: 'http://127.0.0.1:8188' },
      replicate: { token: 'r8_test' },
      gpuDetector: () => true,
      fetchImpl: mockFetchOk({ system: { cuda: true } }),
    });
    const provider = await svc.resolveProvider();
    expect(provider?.name).toBe('flux-local');
  });

  it('mode=auto · 无 GPU + replicate token ok → replicate · 都没 → null', async () => {
    // token OK 场景
    const svcA = new FluxService({
      mode: 'auto',
      local: { endpoint: 'http://127.0.0.1:8188' },
      replicate: { token: 'r8_test' },
      gpuDetector: () => false,
      fetchImpl: mockFetchOk({ type: 'user' }),
    });
    const providerA = await svcA.resolveProvider();
    expect(providerA?.name).toBe('flux-replicate');

    // 都没 · token 空 · GPU 无
    const svcB = new FluxService({
      mode: 'auto',
      local: { endpoint: 'http://127.0.0.1:8188' },
      replicate: { token: '' },
      gpuDetector: () => false,
      fetchImpl: mockFetchFail(),
    });
    const providerB = await svcB.resolveProvider();
    expect(providerB).toBeNull();

    // generate() 抛清晰错
    await expect(
      svcB.generate({ prompt: 'test', count: 1 }),
    ).rejects.toThrow(/No Flux backend/);
  });
});
