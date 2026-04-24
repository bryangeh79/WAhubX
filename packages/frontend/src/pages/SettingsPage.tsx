// 2026-04-21 · Admin 合并进设置 · 7 子菜单
// 2026-04-24 · 重构: 带图标侧边栏 + 分卡片布局 + 复制按钮 + 账号头像
import { useState } from 'react';
import { Alert, Button, Card, Layout, Menu, Tag, Tooltip, Typography, message } from 'antd';
import {
  ApiOutlined,
  AppstoreOutlined,
  BankOutlined,
  CopyOutlined,
  GlobalOutlined,
  InfoCircleOutlined,
  PictureOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useAuth } from '@/auth/AuthContext';
import { AiTab } from './admin/AiTab';
import { AssetsTab } from './admin/AssetsTab';
import { BackupTab } from './admin/BackupTab';
import { UpgradeTab } from './admin/UpgradeTab';
import { ScriptsTab } from './admin/ScriptsTab';
import { WarmupTab } from './admin/WarmupTab';
import { ChannelsTab } from './admin/ChannelsTab';
import { ProxyPanel as ProxyPanelFull } from './admin/ProxyPanel';
import { LicensesTab } from './AdminPage';

const { Sider, Content } = Layout;
const { Title, Paragraph, Text } = Typography;

const CARD_STYLE = {
  boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
  borderRadius: 8,
};

type SettingsKey =
  | 'tenant'
  | 'licenses'
  | 'users'
  | 'assets'
  | 'ai'
  | 'proxy'
  | 'maintenance'
  | 'about';

export function SettingsPage() {
  const { user } = useAuth();
  const isPlatformAdmin = user?.tenantId === null;
  const [selected, setSelected] = useState<SettingsKey>('tenant');

  const menuItems = [
    { key: 'tenant', icon: <BankOutlined />, label: '租户信息' },
    ...(isPlatformAdmin ? [{ key: 'licenses', icon: <SafetyCertificateOutlined />, label: 'License 管理' }] : []),
    { key: 'users', icon: <TeamOutlined />, label: '用户管理' },
    { key: 'assets', icon: <PictureOutlined />, label: '素材库' },
    { key: 'ai', icon: <ThunderboltOutlined />, label: 'AI 配置' },
    { key: 'proxy', icon: <GlobalOutlined />, label: '代理管理' },
    { key: 'maintenance', icon: <ToolOutlined />, label: '系统维护' },
    { key: 'about', icon: <InfoCircleOutlined />, label: '关于 WAhubX' },
  ];

  return (
    <Layout style={{ background: 'transparent', minHeight: 600, gap: 16 }}>
      <Sider
        width={240}
        theme="light"
        style={{ background: '#fff', borderRadius: 8, boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}
      >
        <div style={{ padding: '20px 20px 12px 20px', borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#1f1f1f' }}>设置中心</div>
          <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 4, lineHeight: 1.5 }}>
            管理租户、用户、素材、AI 与系统配置
          </div>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selected]}
          onClick={(e) => setSelected(e.key as SettingsKey)}
          style={{ borderRight: 0, padding: '8px 8px 16px 8px' }}
          items={menuItems}
        />
      </Sider>
      <Content style={{ paddingLeft: 0 }}>
        {selected === 'tenant' && <TenantInfoPanel />}
        {selected === 'licenses' && isPlatformAdmin && <LicensesPanel />}
        {selected === 'users' && <UsersPanel />}
        {selected === 'assets' && <AssetsPanel />}
        {selected === 'ai' && <AiPanel />}
        {selected === 'proxy' && <ProxyPanel />}
        {selected === 'maintenance' && <MaintenancePanel />}
        {selected === 'about' && <AboutPanel />}
      </Content>
    </Layout>
  );
}

// ──────────────────────────────────────────────────────────────
// 小组件
// ──────────────────────────────────────────────────────────────

function PageHeader({
  title,
  subtitle,
  extra,
}: {
  title: string;
  subtitle?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 20,
        flexWrap: 'wrap',
        gap: 12,
      }}
    >
      <div>
        <Title level={3} style={{ margin: 0 }}>
          {title}
        </Title>
        {subtitle && (
          <Text type="secondary" style={{ fontSize: 13 }}>
            {subtitle}
          </Text>
        )}
      </div>
      {extra && <div>{extra}</div>}
    </div>
  );
}

function SectionCard({
  icon,
  title,
  children,
  style,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <Card
      size="small"
      style={{ ...CARD_STYLE, ...(style ?? {}) }}
      styles={{ body: { padding: 20 } }}
      title={
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 22,
              height: 22,
              background: '#25d366',
              borderRadius: 4,
              color: 'white',
              fontSize: 12,
              marginRight: 8,
              verticalAlign: 'middle',
            }}
          >
            {icon}
          </span>
          {title}
        </span>
      }
    >
      {children}
    </Card>
  );
}

function InfoRow({
  label,
  children,
  last,
}: {
  label: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '140px 1fr',
        alignItems: 'center',
        padding: '12px 0',
        borderBottom: last ? 'none' : '1px solid #f0f0f0',
      }}
    >
      <span style={{ color: '#8c8c8c', fontSize: 13 }}>{label}</span>
      <span style={{ color: '#1f1f1f', fontSize: 13, fontWeight: 500 }}>{children}</span>
    </div>
  );
}

function CopyChip({ text }: { text: string }) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      message.success('已复制');
    } catch {
      message.error('复制失败');
    }
  };
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <code
        style={{
          padding: '4px 10px',
          background: '#fafafa',
          border: '1px solid #f0f0f0',
          borderRadius: 4,
          fontSize: 12,
          fontFamily: 'Menlo, Consolas, monospace',
        }}
      >
        {text}
      </code>
      <Tooltip title="复制">
        <Button size="small" icon={<CopyOutlined />} onClick={handleCopy}>
          复制
        </Button>
      </Tooltip>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// 租户信息 · 主要重构页面
// ──────────────────────────────────────────────────────────────

function TenantInfoPanel() {
  const { user, licenseStatus, refreshLicenseStatus } = useAuth();
  if (!user) return null;

  const maskedKey = licenseStatus?.licenseKey
    ? `${licenseStatus.licenseKey.slice(0, 7)}****${licenseStatus.licenseKey.slice(-4)}`
    : '—';

  const handleRefresh = async () => {
    try {
      await refreshLicenseStatus();
      message.success('已刷新');
    } catch {
      message.error('刷新失败');
    }
  };

  const tenantName = licenseStatus?.tenantName ?? '平台超级管理员';
  const avatarText = tenantName.slice(0, 2).toUpperCase();

  return (
    <div>
      <PageHeader
        title="租户信息"
        subtitle="查看当前租户套餐、授权状态与账号信息"
        extra={
          <Button onClick={handleRefresh}>
            🔄 刷新信息
          </Button>
        }
      />

      {/* 基础信息 */}
      <SectionCard icon={<BankOutlined />} title="基础信息" style={{ marginBottom: 16 }}>
        <InfoRow label="租户名称">{tenantName}</InfoRow>
        <InfoRow label="套餐">
          {licenseStatus?.plan ? (
            <Tag
              style={{
                background: '#f0faf4',
                color: '#25d366',
                border: '1px solid #b7eb8f',
                padding: '2px 10px',
                fontWeight: 500,
              }}
            >
              {licenseStatus.plan.toUpperCase()} · {licenseStatus.slotLimit} 槽
            </Tag>
          ) : (
            '—'
          )}
        </InfoRow>
        <InfoRow label="到期时间" last>
          {licenseStatus?.expiresAt ? new Date(licenseStatus.expiresAt).toLocaleDateString() : '永久'}
        </InfoRow>
      </SectionCard>

      {/* 授权信息 */}
      <SectionCard icon={<SafetyCertificateOutlined />} title="授权信息" style={{ marginBottom: 16 }}>
        <InfoRow label="License 状态">
          {licenseStatus?.revoked ? (
            <Tag color="error">已吊销</Tag>
          ) : licenseStatus?.valid ? (
            <Tag
              style={{
                background: '#f0faf4',
                color: '#25d366',
                border: '1px solid #b7eb8f',
                padding: '2px 10px',
                fontWeight: 500,
              }}
            >
              有效
            </Tag>
          ) : (
            <Tag color="warning">未激活</Tag>
          )}
        </InfoRow>
        <InfoRow label="License Key">
          <CopyChip text={maskedKey} />
        </InfoRow>
        <InfoRow label="绑定机器指纹" last>
          <CopyChip text={licenseStatus?.machineId ?? '—'} />
        </InfoRow>
      </SectionCard>

      {/* 当前账号 */}
      <SectionCard icon={<UserOutlined />} title="当前账号" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              background: '#f0faf4',
              color: '#25d366',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {avatarText}
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '60px 1fr',
                rowGap: 8,
                fontSize: 13,
              }}
            >
              <span style={{ color: '#8c8c8c' }}>用户名:</span>
              <span style={{ fontWeight: 500 }}>{user.username}</span>
              <span style={{ color: '#8c8c8c' }}>邮箱:</span>
              <span>{user.email}</span>
              <span style={{ color: '#8c8c8c' }}>角色:</span>
              <span>
                <Tag
                  style={{
                    background: user.role === 'admin' ? '#1f1f1f' : '#f0f0f0',
                    color: user.role === 'admin' ? '#fff' : '#333',
                    border: 'none',
                    padding: '2px 10px',
                    fontWeight: 500,
                    letterSpacing: 0.5,
                  }}
                >
                  {user.role.toUpperCase()}
                </Tag>
                <span style={{ color: '#8c8c8c', fontSize: 12, marginLeft: 8 }}>
                  {user.role === 'admin'
                    ? '拥有系统管理权限'
                    : user.role === 'operator'
                      ? '拥有运营权限'
                      : '只读权限'}
                </span>
              </span>
            </div>
          </div>
        </div>
      </SectionCard>

      <Alert
        type="info"
        showIcon
        message="授权信息仅用于当前设备校验, 请勿公开 License Key 与机器指纹"
        style={{ border: '1px solid #91d5ff', background: '#e6f7ff' }}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// 其他面板 · 沿用原逻辑 · 套统一 PageHeader + Card
// ──────────────────────────────────────────────────────────────

function LicensesPanel() {
  return (
    <div>
      <PageHeader
        title="License 管理"
        subtitle="生成 / 吊销 / 解绑 License · 发给租户激活 · 通过 VPS License Server 代理存储"
      />
      <Card size="small" style={CARD_STYLE} styles={{ body: { padding: 20 } }}>
        <LicensesTab />
      </Card>
    </div>
  );
}

function UsersPanel() {
  return (
    <div>
      <PageHeader title="用户管理" subtitle="管理本租户的 admin / operator / viewer 权限" />
      <Card size="small" style={CARD_STYLE} styles={{ body: { padding: 20 } }}>
        <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 0 }}>
          详细 CRUD 请前往 <a href="/admin">旧 Admin 页面 · 用户管理</a> tab (Settings 7 子菜单完整迁移待 Phase 3).
        </Paragraph>
      </Card>
    </div>
  );
}

function AssetsPanel() {
  return (
    <div>
      <PageHeader title="素材库" subtitle="剧本 / Persona / 图视音 / 频道" />
      <SectionCard icon={<ApiOutlined />} title="频道 · WA Channels" style={{ marginBottom: 16 }}>
        <ChannelsTab />
      </SectionCard>
      <SectionCard icon={<AppstoreOutlined />} title="剧本包" style={{ marginBottom: 16 }}>
        <ScriptsTab />
      </SectionCard>
      <SectionCard icon={<UserOutlined />} title="Persona + 养号计划模板" style={{ marginBottom: 16 }}>
        <WarmupTab />
      </SectionCard>
      <SectionCard icon={<PictureOutlined />} title="图片 / 视频 / 语音素材">
        <AssetsTab />
      </SectionCard>
    </div>
  );
}

function AiPanel() {
  return (
    <div>
      <PageHeader title="AI 配置" subtitle="配置 DeepSeek / Gemini / OpenAI / Claude 的 API Key" />
      <Card size="small" style={CARD_STYLE} styles={{ body: { padding: 20 } }}>
        <AiTab />
      </Card>
    </div>
  );
}

function ProxyPanel() {
  return (
    <div>
      <PageHeader title="代理管理" subtitle="为每个 slot 配置代理 / VPN · 住宅静态推荐" />
      <Card size="small" style={CARD_STYLE} styles={{ body: { padding: 20 } }}>
        <ProxyPanelFull />
      </Card>
    </div>
  );
}

function MaintenancePanel() {
  return (
    <div>
      <PageHeader title="系统维护" subtitle="备份 / 升级 / 日志" />
      <SectionCard icon={<SettingOutlined />} title="备份" style={{ marginBottom: 16 }}>
        <BackupTab />
      </SectionCard>
      <SectionCard icon={<ToolOutlined />} title="升级">
        <UpgradeTab />
      </SectionCard>
    </div>
  );
}

function AboutPanel() {
  const { licenseStatus } = useAuth();
  return (
    <div>
      <PageHeader title="关于 WAhubX" subtitle="WhatsApp 多账号自动化运营平台 · 本地桌面应用" />
      <Card size="small" style={CARD_STYLE} styles={{ body: { padding: 24 } }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>
            WA<span style={{ color: '#25d366' }}>hub</span>X
          </div>
          <div style={{ color: '#8c8c8c', fontSize: 13, marginTop: 4 }}>v1.0.0-rc3.2</div>
        </div>
        <InfoRow label="机器指纹">
          <CopyChip text={licenseStatus?.machineId ?? '—'} />
        </InfoRow>
        <InfoRow label="License">
          <CopyChip text={licenseStatus?.licenseKey ?? '—'} />
        </InfoRow>
        <InfoRow label="License 状态">
          {licenseStatus?.revoked ? (
            <Tag color="error">已吊销</Tag>
          ) : licenseStatus?.valid ? (
            <Tag color="success">有效</Tag>
          ) : (
            <Tag color="warning">未激活</Tag>
          )}
        </InfoRow>
        <InfoRow label="联系方式">bryangeh79@gmail.com</InfoRow>
        <InfoRow label="GitHub" last>
          <a href="https://github.com/bryangeh79/WAhubX" target="_blank" rel="noreferrer">
            bryangeh79/WAhubX
          </a>
        </InfoRow>
      </Card>
    </div>
  );
}
