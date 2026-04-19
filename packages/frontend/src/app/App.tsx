import { Button, Layout, Menu, Popconfirm, Space } from 'antd';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { DashboardPage } from '@/pages/DashboardPage';
import { HealthPage } from '@/pages/HealthPage';
import { LoginPage } from '@/pages/LoginPage';
import { ActivatePage } from '@/pages/ActivatePage';
import { SlotsPage } from '@/pages/SlotsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { AdminPage } from '@/pages/AdminPage';
import { useAuth } from '@/auth/AuthContext';
import { ActivateGuard, LoginGuard, ProtectedRoute } from '@/auth/RouteGate';

const { Header, Content } = Layout;

function Shell({ children }: { children: React.ReactNode }) {
  const { user, licenseStatus, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  let selected: string[] = ['dashboard'];
  if (location.pathname.startsWith('/slots')) selected = ['slots'];
  else if (location.pathname.startsWith('/health')) selected = ['health'];
  else if (location.pathname.startsWith('/settings')) selected = ['settings'];
  else if (location.pathname.startsWith('/admin')) selected = ['admin'];

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const isAdmin = user?.role === 'admin';

  const items = [
    { key: 'dashboard', label: <Link to="/">仪表盘</Link> },
    { key: 'slots', label: <Link to="/slots">账号槽位</Link> },
    ...(isAdmin ? [{ key: 'admin', label: <Link to="/admin">Admin 后台</Link> }] : []),
    { key: 'settings', label: <Link to="/settings">设置</Link> },
    { key: 'health', label: <Link to="/health">系统健康</Link> },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', background: '#001529', padding: '0 24px' }}>
        <div style={{ color: '#fff', fontSize: 18, fontWeight: 600, marginRight: 32 }}>WAhubX</div>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={selected}
          items={items}
          style={{ flex: 1, minWidth: 0 }}
        />
        <Space>
          {licenseStatus?.tenantName && (
            <span style={{ color: 'rgba(255,255,255,0.65)' }}>
              {licenseStatus.tenantName} / {user?.username}
            </span>
          )}
          <Popconfirm title="确认登出？" okText="登出" cancelText="取消" onConfirm={handleLogout}>
            <Button size="small">登出</Button>
          </Popconfirm>
        </Space>
      </Header>
      <Content style={{ padding: 24 }}>{children}</Content>
    </Layout>
  );
}

export function App() {
  return (
    <Routes>
      <Route
        path="/activate"
        element={
          <ActivateGuard>
            <ActivatePage />
          </ActivateGuard>
        }
      />
      <Route
        path="/login"
        element={
          <LoginGuard>
            <LoginPage />
          </LoginGuard>
        }
      />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Shell>
              <DashboardPage />
            </Shell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/slots"
        element={
          <ProtectedRoute>
            <Shell>
              <SlotsPage />
            </Shell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <Shell>
              <AdminPage />
            </Shell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <Shell>
              <SettingsPage />
            </Shell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/health"
        element={
          <ProtectedRoute>
            <Shell>
              <HealthPage />
            </Shell>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
