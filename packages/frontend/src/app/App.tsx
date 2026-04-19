import { Layout, Menu } from 'antd';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { HealthPage } from '@/pages/HealthPage';

const { Header, Content } = Layout;

export function App() {
  const location = useLocation();
  const selected = location.pathname.startsWith('/health') ? ['health'] : [];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', background: '#001529' }}>
        <div style={{ color: '#fff', fontSize: 18, fontWeight: 600, marginRight: 32 }}>
          WAhubX
        </div>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={selected}
          items={[{ key: 'health', label: <Link to="/health">系统健康</Link> }]}
          style={{ flex: 1, minWidth: 0 }}
        />
      </Header>
      <Content style={{ padding: 24 }}>
        <Routes>
          <Route path="/" element={<Navigate to="/health" replace />} />
          <Route path="/health" element={<HealthPage />} />
          <Route path="*" element={<div>404 · 页面不存在</div>} />
        </Routes>
      </Content>
    </Layout>
  );
}
