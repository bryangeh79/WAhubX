import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';

const ACCESS_KEY = 'wahubx_access_token';
const REFRESH_KEY = 'wahubx_refresh_token';
const USER_KEY = 'wahubx_user';

export interface StoredUser {
  id: string;
  email: string;
  username: string;
  role: 'admin' | 'operator' | 'viewer';
  tenantId: number | null;
  fullName: string | null;
  avatarUrl: string | null;
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function getStoredUser(): StoredUser | null {
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredUser;
  } catch {
    return null;
  }
}

export function setSession(
  tokens: { accessToken: string; refreshToken: string } | null,
  user: StoredUser | null,
): void {
  if (tokens) {
    localStorage.setItem(ACCESS_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  } else {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  }
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(USER_KEY);
  }
}

export const api: AxiosInstance = axios.create({
  baseURL: '/api/v1',
  timeout: 10_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});

let on401: (() => void) | null = null;
export function registerOn401(fn: () => void): void {
  on401 = fn;
}

// M9 patch (v0.9.1-m9) · 401 auto-refresh
//
// 问题: access token 15min TTL · 到期新请求 401 · 原拦截器直接强登出 → TakeoverTab 每 15min
// 踢回登录页 · 演示级 UX bug (handoff smoke 暴露).
//
// 方案: 401 首次命中 → 用 refresh token 调 /auth/refresh 换新 access · retry 原请求一次.
// 若 refresh 本身 401 / 无 refresh token → 走原登出路径.
//
// 并发控制: 多个请求同时 401 共享一次 refresh (in-flight promise).
// 防无限循环: original._retry 标记 · 同一 config 只 retry 一次.
// 豁免: /auth/refresh + /auth/login 自身的 401 不尝试 refresh (避免递归).

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

let inflightRefresh: Promise<string> | null = null;

async function doRefresh(): Promise<string> {
  const refresh = getRefreshToken();
  if (!refresh) throw new Error('NO_REFRESH_TOKEN');
  // 走 api 实例, 但带 _retry=true 标避免响应拦截器再次尝试 refresh
  // 同时路径含 '/auth/refresh' 也会走 isAuthEndpoint 的 401-直接登出分支
  const res = await api.post<{
    accessToken: string;
    refreshToken: string;
    user: StoredUser;
  }>('/auth/refresh', { refreshToken: refresh }, { _retry: true } as RetriableConfig);
  setSession(
    { accessToken: res.data.accessToken, refreshToken: res.data.refreshToken },
    res.data.user,
  );
  return res.data.accessToken;
}

function isAuthEndpoint(url: string | undefined): boolean {
  if (!url) return false;
  return url.includes('/auth/refresh') || url.includes('/auth/login') || url.includes('/auth/activate');
}

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const status = err?.response?.status;
    const original = err.config as RetriableConfig | undefined;

    // 非 401 直接抛
    if (status !== 401) return Promise.reject(err);

    // 无 config 无法重发; auth 端点 401 是真登录失败; 已重试过不再试
    if (!original || original._retry || isAuthEndpoint(original.url)) {
      setSession(null, null);
      on401?.();
      return Promise.reject(err);
    }

    original._retry = true;

    try {
      // 并发场景共享同一次 refresh
      const newToken = await (inflightRefresh ?? (inflightRefresh = doRefresh().finally(() => {
        inflightRefresh = null;
      })));
      original.headers.set('Authorization', `Bearer ${newToken}`);
      return api(original);
    } catch (refreshErr) {
      // 若 refresh 本身返 401, isAuthEndpoint 分支已经清 session + 调 on401 一次 · 此处不重复触发
      if (getAccessToken() !== null) {
        setSession(null, null);
        on401?.();
      }
      return Promise.reject(refreshErr);
    }
  },
);

// 提取后端错误消息的通用函数
export function extractErrorMessage(err: unknown, fallback = '请求失败'): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string | string[] } | undefined;
    if (Array.isArray(data?.message)) return data.message.join('; ');
    if (typeof data?.message === 'string') return data.message;
    if (err.message) return err.message;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}
