import { Button, Layout, Menu, Popconfirm, Space } from 'antd';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { DashboardPage } from '@/pages/DashboardPage';
import { HealthPage } from '@/pages/HealthPage';
import { LoginPage } from '@/pages/LoginPage';
import { ActivatePage } from '@/pages/ActivatePage';
import { SlotsPage } from '@/pages/SlotsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { AdminPage } from '@/pages/AdminPage';
import { SchedulerPage } from '@/pages/SchedulerPage';
import { MonitoringPage } from '@/pages/MonitoringPage';
import { TakeoverPage } from '@/pages/TakeoverPage';
import { AdsHomePage } from '@/pages/ads/AdsHomePage';
import { ReplyPage } from '@/pages/reply/ReplyPage';
import { useAuth } from '@/auth/AuthContext';
import { ActivateGuard, LoginGuard, ProtectedRoute } from '@/auth/RouteGate';
import { useCampaignFlag } from '@/lib/useCampaignFlag';

const { Header, Content } = Layout;

function Shell({ children }: { children: React.ReactNode }) {
  const { user, licenseStatus, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const adsEnabled = useCampaignFlag();

  let selected: string[] = ['dashboard'];
  if (location.pathname.startsWith('/slots')) selected = ['slots'];
  else if (location.pathname.startsWith('/scheduler')) selected = ['scheduler'];
  else if (location.pathname.startsWith('/ads')) selected = ['ads'];
  else if (location.pathname.startsWith('/reply')) selected = ['reply'];
  else if (location.pathname.startsWith('/takeover')) selected = ['takeover'];
  else if (location.pathname.startsWith('/settings')) selected = ['settings'];
  else if (location.pathname.startsWith('/admin')) selected = ['settings']; // Admin 合进设置 · 保留路由
  // 2026-04-24 · 健康分 / 运营监控 合进仪表盘 · 路由保留防书签失效 · nav 移除

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  // 2026-04-21 · 用户要求: Admin 后台和设置合并 · 顶部只放日常运营的 tab · 配置类归"设置"
  // 顺序: 日常看 (仪表盘/槽位/任务/监控/接管/健康) · 偶尔配 (设置)
  const items = [
    { key: 'dashboard', label: <Link to="/">仪表盘</Link> },
    { key: 'slots', label: <Link to="/slots">账号槽位</Link> },
    { key: 'scheduler', label: <Link to="/scheduler">任务调度</Link> },
    // 2026-04-23 · 广告投放 · feature flag app_setting 'campaign.module_enabled' 开启时才显
    ...(adsEnabled ? [{ key: 'ads', label: <Link to="/ads">广告投放</Link> }] : []),
    { key: 'reply', label: <Link to="/reply">智能客服</Link> },
    { key: 'takeover', label: <Link to="/takeover">人工接管</Link> },
    { key: 'settings', label: <Link to="/settings">设置</Link> },
  ];

  return (
    <Layout style={{ minHeight: '100vh', background: '#f5f7fa' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          background: '#fff',
          padding: '0 24px',
          boxShadow: '0 1px 4px rgba(0, 0, 0, 0.06)',
          borderBottom: '1px solid #f0f0f0',
          height: 56,
          lineHeight: '56px',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <div
          style={{
            fontSize: 19,
            fontWeight: 700,
            marginRight: 40,
            color: '#1f1f1f',
            letterSpacing: '-0.3px',
          }}
        >
          WA<span style={{ color: '#25d366' }}>hub</span>X
        </div>
        <Menu
          theme="light"
          mode="horizontal"
          selectedKeys={selected}
          items={items}
          style={{ flex: 1, minWidth: 0, borderBottom: 'none', fontWeight: 500 }}
        />
        <Space size={12}>
          {licenseStatus?.tenantName && (
            <span style={{ color: '#8c8c8c', fontSize: 13 }}>
              <span style={{ color: '#333', fontWeight: 500 }}>{licenseStatus.tenantName}</span>
              <span style={{ margin: '0 6px', color: '#d9d9d9' }}>·</span>
              {user?.username}
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
        path="/scheduler"
        element={
          <ProtectedRoute>
            <Shell>
              <SchedulerPage />
            </Shell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/monitoring"
        element={
          <ProtectedRoute>
            <Shell>
              <MonitoringPage />
            </Shell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/takeover"
        element={
          <ProtectedRoute>
            <Shell>
              <TakeoverPage />
            </Shell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/reply/*"
        element={
          <ProtectedRoute>
            <Shell>
              <ReplyPage />
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
        path="/ads/*"
        element={
          <ProtectedRoute>
            <Shell>
              <AdsHomePage />
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
