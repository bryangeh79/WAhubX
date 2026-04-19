import { Navigate, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';

// 启动时决策路由去向:
//   未激活 license         → /activate
//   已激活 / 未登录        → /login
//   已激活 / 已登录        → children (受保护页)
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, licenseStatus, isBooting } = useAuth();
  const location = useLocation();

  if (isBooting) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  if (!licenseStatus?.activated) {
    return <Navigate to="/activate" replace state={{ from: location }} />;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}

// 激活页/登录页入口: 如果已满足后续条件, 自动往后跳
export function ActivateGuard({ children }: { children: ReactNode }) {
  const { licenseStatus, isBooting } = useAuth();
  if (isBooting) return null;
  if (licenseStatus?.activated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function LoginGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, licenseStatus, isBooting } = useAuth();
  if (isBooting) return null;
  if (!licenseStatus?.activated) return <Navigate to="/activate" replace />;
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
}
