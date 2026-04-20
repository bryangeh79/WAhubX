// M9 patch (v0.9.1-m9) · api.ts 401 auto-refresh 行为测试
//
// 验证 3 路径:
//   1. refresh 成功 · 原请求 silently 200 (用户不感知)
//   2. refresh 失败 · 原错误抛 + setSession null + on401 触发
//   3. 防无限循环 · 同一 config 只 retry 一次 · retry 后仍 401 不再 refresh
//   4. auth 端点自身 401 不触发 refresh (避免递归)

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import MockAdapter from 'axios-mock-adapter';

// jsdom 25 在某些 vitest runtime 下 localStorage 缺失 · polyfill 简版即可
beforeAll(() => {
  if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.clear !== 'function') {
    const store: Record<string, string> = {};
    const impl: Storage = {
      get length() { return Object.keys(store).length; },
      clear() { for (const k of Object.keys(store)) delete store[k]; },
      getItem(k: string) { return k in store ? store[k] : null; },
      key(i: number) { return Object.keys(store)[i] ?? null; },
      removeItem(k: string) { delete store[k]; },
      setItem(k: string, v: string) { store[k] = String(v); },
    };
    Object.defineProperty(globalThis, 'localStorage', { value: impl, writable: true });
  }
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const apiMod = await import('./api');
const { api, registerOn401, setSession } = apiMod;

describe('api.ts · 401 auto-refresh 拦截器', () => {
  let mock: MockAdapter;
  let onLogout: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // doRefresh 现在走 api 实例 (带 _retry 标防递归), 所以 mock 只需挂 api
    mock = new MockAdapter(api);
    localStorage.clear();
    onLogout = vi.fn();
    registerOn401(onLogout);
    setSession(
      { accessToken: 'old-access', refreshToken: 'valid-refresh' },
      {
        id: 'u1',
        email: 'admin@wahubx.local',
        username: 'admin',
        role: 'admin',
        tenantId: 4,
        fullName: null,
        avatarUrl: null,
      },
    );
  });

  it('refresh 成功路径 · 原请求 silently 200 · localStorage 更新新 token', async () => {
    // /chats/1/conversations 首发返 401 · 触发 refresh
    let chatCallCount = 0;
    mock.onGet('/api/v1/chats/1/conversations').reply((config) => {
      chatCallCount++;
      const auth = config.headers?.Authorization ?? config.headers?.authorization ?? '';
      if (auth === 'Bearer old-access') return [401, { message: 'token expired' }];
      if (auth === 'Bearer new-access') return [200, { contacts: [{ id: 1, remoteJid: 'x@s' }] }];
      return [500, { message: 'unexpected token' }];
    });

    // /auth/refresh 返 new tokens
    mock.onPost('/api/v1/auth/refresh').reply(200, {
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      user: {
        id: 'u1',
        email: 'admin@wahubx.local',
        username: 'admin',
        role: 'admin',
        tenantId: 4,
        fullName: null,
        avatarUrl: null,
      },
    });

    const res = await api.get('/chats/1/conversations');
    expect(res.status).toBe(200);
    expect(res.data.contacts).toHaveLength(1);
    expect(chatCallCount).toBe(2); // 1 次 401 + 1 次 retry 200
    expect(localStorage.getItem('wahubx_access_token')).toBe('new-access');
    expect(localStorage.getItem('wahubx_refresh_token')).toBe('new-refresh');
    expect(onLogout).not.toHaveBeenCalled();
  });

  it('refresh 失败路径 · 原错误抛 · setSession null · on401 触发', async () => {
    mock.onGet('/api/v1/chats/1/conversations').reply(401, { message: 'token expired' });
    // refresh 返 401 (refresh token 也过期了)
    mock.onPost('/api/v1/auth/refresh').reply(401, { message: 'refresh expired' });

    await expect(api.get('/chats/1/conversations')).rejects.toThrow();
    expect(localStorage.getItem('wahubx_access_token')).toBeNull();
    expect(localStorage.getItem('wahubx_refresh_token')).toBeNull();
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('防无限循环 · retry 后仍 401 不再 refresh · 直接登出', async () => {
    // 原请求每次都 401, refresh 成功, retry 后第 2 次仍 401 → 不应第 3 次 refresh
    mock.onGet('/api/v1/chats/1/conversations').reply(401, { message: 'token expired' });
    mock.onPost('/api/v1/auth/refresh').reply(200, {
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      user: {
        id: 'u1', email: 'admin@wahubx.local', username: 'admin', role: 'admin',
        tenantId: 4, fullName: null, avatarUrl: null,
      },
    });

    await expect(api.get('/chats/1/conversations')).rejects.toThrow();

    const chatHits = mock.history.get.filter((r) => r.url === '/chats/1/conversations');
    const refreshHits = mock.history.post.filter((r) => r.url?.includes('/auth/refresh'));
    expect(chatHits).toHaveLength(2); // 原请求 + 1 retry · 不应再第 3 次
    expect(refreshHits).toHaveLength(1); // refresh 只调一次
    expect(onLogout).toHaveBeenCalledTimes(1); // retry 后 401 登出
  });

  it('auth 端点自身 401 不触发 refresh · 避免 /auth/refresh → /auth/refresh 递归', async () => {
    mock.onPost('/api/v1/auth/login').reply(401, { message: 'bad creds' });
    mock.onPost('/api/v1/auth/refresh').reply(200, {
      accessToken: 'x', refreshToken: 'y',
      user: { id: 'u1', email: 'x', username: 'x', role: 'admin', tenantId: 4, fullName: null, avatarUrl: null },
    });

    await expect(api.post('/auth/login', { email: 'x', password: 'y' })).rejects.toThrow();
    const refreshHits = mock.history.post.filter((r) => r.url?.includes('/auth/refresh'));
    expect(refreshHits).toHaveLength(0); // login 401 不应触发 refresh
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
