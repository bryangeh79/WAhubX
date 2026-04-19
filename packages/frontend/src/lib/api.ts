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

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401) {
      setSession(null, null);
      on401?.();
    }
    return Promise.reject(err);
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
