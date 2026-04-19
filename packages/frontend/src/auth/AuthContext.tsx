import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, getAccessToken, getStoredUser, registerOn401, setSession, type StoredUser } from '@/lib/api';

export interface LicenseStatus {
  activated: boolean;
  valid: boolean;
  licenseKey: string | null;
  plan: string | null;
  slotLimit: number | null;
  tenantName: string | null;
  expiresAt: string | null;
  machineId: string;
  revoked: boolean;
  error?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface ActivateInput {
  licenseKey: string;
  adminEmail: string;
  adminUsername: string;
  adminPassword: string;
  adminFullName?: string;
}

interface AuthContextValue {
  user: StoredUser | null;
  isAuthenticated: boolean;
  licenseStatus: LicenseStatus | null;
  isBooting: boolean;
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
  activate: (input: ActivateInput) => Promise<void>;
  refreshLicenseStatus: () => Promise<LicenseStatus>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  tokenType: 'Bearer';
  user: StoredUser;
}

interface ActivationResponse {
  licenseKey: string;
  tenant: { id: number; name: string; plan: string; slotLimit: number };
  user: { id: string; email: string; username: string; role: StoredUser['role'] };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<StoredUser | null>(() => getStoredUser());
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);
  const [isBooting, setIsBooting] = useState(true);

  const refreshLicenseStatus = useCallback(async (): Promise<LicenseStatus> => {
    const res = await api.get<LicenseStatus>('/license/status');
    setLicenseStatus(res.data);
    return res.data;
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const res = await api.post<TokenResponse>('/auth/login', input);
    setSession({ accessToken: res.data.accessToken, refreshToken: res.data.refreshToken }, res.data.user);
    setUser(res.data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      if (getAccessToken()) await api.post('/auth/logout');
    } catch {
      // 后端登出失败 (比如 token 已失效) 也不阻塞本地清理
    }
    setSession(null, null);
    setUser(null);
  }, []);

  const activate = useCallback(
    async (input: ActivateInput) => {
      const res = await api.post<ActivationResponse>('/license/activate', input);
      // 激活成功后自动用同一密码登录, 拿到 tokens
      await login({ email: input.adminEmail, password: input.adminPassword });
      await refreshLicenseStatus();
      return void res;
    },
    [login, refreshLicenseStatus],
  );

  // 启动引导 + 401 自动清会话
  useEffect(() => {
    registerOn401(() => setUser(null));
    refreshLicenseStatus()
      .catch(() => {/* 后端未起时不阻塞 */})
      .finally(() => setIsBooting(false));
  }, [refreshLicenseStatus]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: !!user && !!getAccessToken(),
      licenseStatus,
      isBooting,
      login,
      logout,
      activate,
      refreshLicenseStatus,
    }),
    [user, licenseStatus, isBooting, login, logout, activate, refreshLicenseStatus],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
