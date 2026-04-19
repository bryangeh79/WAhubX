import { useState } from 'react';
import { Alert, Card, Descriptions, Layout, Menu, Tag, Typography } from 'antd';
import { useAuth } from '@/auth/AuthContext';

const { Sider, Content } = Layout;
const { Title, Paragraph } = Typography;

type SettingsKey = 'account' | 'ai' | 'proxy' | 'backup' | 'about';

// M1 Week 4 任务 4.1: 空壳页面, 有导航无实体功能.
// 各面板在对应里程碑实装 — 这里只占位避免未来改路由改菜单.
export function SettingsPage() {
  const [selected, setSelected] = useState<SettingsKey>('account');

  return (
    <Layout style={{ background: 'transparent', minHeight: 500 }}>
      <Sider width={200} theme="light" style={{ background: '#fff', borderRadius: 8 }}>
        <Menu
          mode="inline"
          selectedKeys={[selected]}
          onClick={(e) => setSelected(e.key as SettingsKey)}
          style={{ borderRight: 0, padding: 8 }}
          items={[
            { key: 'account', label: '账号资料' },
            { key: 'ai', label: 'AI 配置' },
            { key: 'proxy', label: '代理设置' },
            { key: 'backup', label: '备份与更新' },
            { key: 'about', label: '关于 WAhubX' },
          ]}
        />
      </Sider>
      <Content style={{ padding: '0 24px' }}>
        {selected === 'account' && <AccountPanel />}
        {selected === 'ai' && <StubPanel title="AI 配置" milestone="M6" />}
        {selected === 'proxy' && <StubPanel title="代理设置" milestone="M1 Week 5+" />}
        {selected === 'backup' && <StubPanel title="备份与更新" milestone="M10" />}
        {selected === 'about' && <AboutPanel />}
      </Content>
    </Layout>
  );
}

function AccountPanel() {
  const { user, licenseStatus } = useAuth();
  if (!user) return null;
  return (
    <Card title="账号资料">
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label="邮箱">{user.email}</Descriptions.Item>
        <Descriptions.Item label="用户名">{user.username}</Descriptions.Item>
        <Descriptions.Item label="姓名">{user.fullName ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="角色">
          <Tag color={user.role === 'admin' ? 'red' : user.role === 'operator' ? 'blue' : 'default'}>
            {user.role.toUpperCase()}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="租户">
          {licenseStatus?.tenantName ?? '平台超级管理员'}
        </Descriptions.Item>
        <Descriptions.Item label="套餐">
          {licenseStatus?.plan ? (
            <Tag color="green">{licenseStatus.plan.toUpperCase()} · {licenseStatus.slotLimit} 槽</Tag>
          ) : '—'}
        </Descriptions.Item>
      </Descriptions>
      <Paragraph type="secondary" style={{ marginTop: 16, fontSize: 12 }}>
        * 改密码 / 修改昵称 / 语言切换 等交互计划 M1 Week 5+ 上线. 当前仅只读展示.
      </Paragraph>
    </Card>
  );
}

function StubPanel({ title, milestone }: { title: string; milestone: string }) {
  return (
    <Card title={title}>
      <Alert
        type="info"
        showIcon
        message={`该功能计划在 ${milestone} 实装`}
        description="当前为 M1 基础骨架阶段, 此面板仅占位, 避免后续改路由/菜单."
      />
    </Card>
  );
}

function AboutPanel() {
  const { licenseStatus } = useAuth();
  return (
    <Card>
      <Title level={3}>WAhubX</Title>
      <Paragraph type="secondary">WhatsApp 多账号自动化运营平台 · 本地桌面应用</Paragraph>
      <Descriptions column={1} bordered size="small" style={{ marginTop: 16 }}>
        <Descriptions.Item label="版本">v0.1.0-m1</Descriptions.Item>
        <Descriptions.Item label="机器指纹">
          <code>{licenseStatus?.machineId ?? '—'}</code>
        </Descriptions.Item>
        <Descriptions.Item label="License">
          <code>{licenseStatus?.licenseKey ?? '—'}</code>
        </Descriptions.Item>
        <Descriptions.Item label="License 状态">
          {licenseStatus?.revoked ? (
            <Tag color="error">已吊销</Tag>
          ) : licenseStatus?.valid ? (
            <Tag color="success">有效</Tag>
          ) : (
            <Tag color="warning">未激活</Tag>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="联系方式">bryangeh79@gmail.com</Descriptions.Item>
        <Descriptions.Item label="License (软件授权)">Proprietary · All Rights Reserved</Descriptions.Item>
      </Descriptions>
    </Card>
  );
}
