import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useAuth } from '@/auth/AuthContext';
import { api, extractErrorMessage } from '@/lib/api';
import { QueueTab } from './admin/QueueTab';
import { ScriptsTab } from './admin/ScriptsTab';
import { WarmupTab } from './admin/WarmupTab';
import { AiTab } from './admin/AiTab';
import { HealthTab } from './admin/HealthTab';
import { TakeoverTab } from './admin/TakeoverTab';
import { BackupTab } from './admin/BackupTab';
import { UpgradeTab } from './admin/UpgradeTab';
import { AssetsTab } from './admin/AssetsTab';

const { Text, Paragraph } = Typography;

interface TenantRow {
  id: number;
  name: string;
  email: string | null;
  plan: 'basic' | 'pro' | 'enterprise';
  slotLimit: number;
  status: string;
  country: string;
  createdAt: string;
}

interface LicenseRow {
  id: number;
  licenseKey: string;
  tenant: { id: number; name: string; plan: string; slotLimit: number } | null;
  machineFingerprint: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  lastVerifiedAt: string | null;
  revoked: boolean;
  createdAt: string;
}

interface UserRow {
  id: string;
  tenantId: number | null;
  email: string;
  username: string;
  role: 'admin' | 'operator' | 'viewer';
  status: 'active' | 'suspended';
  createdAt: string;
}

export function AdminPage() {
  const { user } = useAuth();
  if (user?.role !== 'admin') {
    return (
      <Alert
        type="warning"
        showIcon
        message="无权限"
        description="只有 Admin 角色可以访问该页面."
      />
    );
  }
  return (
    <Tabs
      defaultActiveKey="tenants"
      items={[
        { key: 'tenants', label: '租户管理', children: <TenantsTab /> },
        { key: 'licenses', label: 'License 管理', children: <LicensesTab /> },
        { key: 'users', label: '用户管理', children: <UsersTab /> },
        { key: 'scripts', label: '剧本包', children: <ScriptsTab /> },
        { key: 'assets', label: '素材库', children: <AssetsTab /> },
        { key: 'warmup', label: '养号计划', children: <WarmupTab /> },
        { key: 'ai', label: 'AI 配置', children: <AiTab /> },
        { key: 'health', label: '健康分', children: <HealthTab /> },
        { key: 'takeover', label: '接管', children: <TakeoverTab /> },
        { key: 'backup', label: '备份', children: <BackupTab /> },
        { key: 'upgrade', label: '升级', children: <UpgradeTab /> },
        { key: 'queue', label: '任务队列', children: <QueueTab /> },
      ]}
    />
  );
}

// ── 租户 ─────────────────────────────────────────────────
function TenantsTab() {
  const [data, setData] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<TenantRow[]>('/admin/tenants');
      setData(res.data);
    } catch (err) {
      setError(extractErrorMessage(err, '加载租户失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const columns: ColumnsType<TenantRow> = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '名称', dataIndex: 'name' },
    { title: '邮箱', dataIndex: 'email', render: (v: string | null) => v ?? '—' },
    {
      title: '套餐',
      dataIndex: 'plan',
      render: (plan: TenantRow['plan'], row) => (
        <Tag color="green">{plan.toUpperCase()} · {row.slotLimit} 槽</Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (s: string) => <Tag color={s === 'active' ? 'success' : 'error'}>{s}</Tag>,
    },
    { title: '国家', dataIndex: 'country', width: 80 },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
  ];

  return (
    <Card
      size="small"
      extra={<Button size="small" onClick={() => void load()} loading={loading}>刷新</Button>}
    >
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 12 }} />}
      <Table
        rowKey="id"
        dataSource={data}
        columns={columns}
        loading={loading}
        pagination={{ pageSize: 20 }}
        size="small"
      />
    </Card>
  );
}

// ── License ──────────────────────────────────────────────
export function LicensesTab() {
  const { user } = useAuth();
  const isPlatformAdmin = user?.tenantId === null;
  const [data, setData] = useState<LicenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<LicenseRow[]>('/admin/licenses');
      setData(res.data);
    } catch (err) {
      setError(extractErrorMessage(err, '加载 License 失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleRevoke = async (id: number) => {
    try {
      await api.post(`/admin/licenses/${id}/revoke`);
      message.success('已吊销');
      await load();
    } catch (err) {
      message.error(extractErrorMessage(err, '吊销失败'));
    }
  };

  const columns: ColumnsType<LicenseRow> = useMemo(
    () => [
      {
        title: 'License Key',
        dataIndex: 'licenseKey',
        render: (v: string) => <code style={{ fontSize: 12 }}>{v}</code>,
      },
      {
        title: '租户 / 套餐',
        render: (_: unknown, row) =>
          row.tenant ? (
            <Space>
              <Text>{row.tenant.name}</Text>
              <Tag color="green">{row.tenant.plan.toUpperCase()} · {row.tenant.slotLimit}槽</Tag>
            </Space>
          ) : (
            <Text type="secondary">—</Text>
          ),
      },
      {
        title: '机器指纹',
        dataIndex: 'machineFingerprint',
        render: (v: string | null) =>
          v ? <code style={{ fontSize: 11 }}>{v.substring(0, 8)}…{v.slice(-4)}</code> : <Tag>未绑定</Tag>,
      },
      {
        title: '状态',
        render: (_: unknown, row) =>
          row.revoked ? (
            <Tag color="error">已吊销</Tag>
          ) : row.machineFingerprint ? (
            <Tag color="success">已激活</Tag>
          ) : (
            <Tag color="warning">待激活</Tag>
          ),
      },
      {
        title: '创建时间',
        dataIndex: 'createdAt',
        render: (v: string) => new Date(v).toLocaleString('zh-CN'),
      },
      {
        title: '操作',
        render: (_: unknown, row) =>
          !row.revoked && isPlatformAdmin ? (
            <Popconfirm
              title="确认吊销该 License ？"
              description="吊销后该 License 无法再通过 /license/verify 校验."
              okText="吊销"
              okButtonProps={{ danger: true }}
              cancelText="取消"
              onConfirm={() => void handleRevoke(row.id)}
            >
              <Button size="small" danger>吊销</Button>
            </Popconfirm>
          ) : null,
      },
    ],
    [isPlatformAdmin],
  );

  return (
    <Card
      size="small"
      extra={
        <Space>
          {isPlatformAdmin && (
            <Button type="primary" size="small" onClick={() => setModalOpen(true)}>
              + 创建新租户
            </Button>
          )}
          <Button size="small" onClick={() => void load()} loading={loading}>刷新</Button>
        </Space>
      }
    >
      {!isPlatformAdmin && (
        <Alert
          type="info"
          showIcon
          message="租户管理员视图"
          description="只显示本租户的 License. 生成 / 吊销需平台超级管理员."
          style={{ marginBottom: 12 }}
        />
      )}
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 12 }} />}
      <Table
        rowKey="id"
        dataSource={data}
        columns={columns}
        loading={loading}
        pagination={{ pageSize: 20 }}
        size="small"
      />
      <GenerateLicenseModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onDone={() => {
          setModalOpen(false);
          void load();
        }}
      />
    </Card>
  );
}

// 2026-04-21 · 改名 "生成 License" → "创建新租户"
// 加租户 admin 登录凭据字段 (email/username/password/fullName) · 激活时自动建本地 user
function GenerateLicenseModal({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [generatedInfo, setGeneratedInfo] = useState<{
    email?: string;
    password?: string;
  } | null>(null);

  const [expireMode, setExpireMode] = useState<'never' | '1m' | '3m' | '6m' | '1y' | 'custom'>('1y');
  const [customExpireDate, setCustomExpireDate] = useState<string>('');

  // 按 preset 算过期 ISO · 基准=今天
  const computeExpiresAt = (mode: typeof expireMode): string | undefined => {
    if (mode === 'never') return undefined;
    if (mode === 'custom') {
      if (!customExpireDate) return undefined;
      return new Date(customExpireDate + 'T23:59:59Z').toISOString();
    }
    const now = new Date();
    const months = mode === '1m' ? 1 : mode === '3m' ? 3 : mode === '6m' ? 6 : 12;
    now.setMonth(now.getMonth() + months);
    return now.toISOString();
  };

  const previewText = (): string => {
    const iso = computeExpiresAt(expireMode);
    if (!iso) return expireMode === 'custom' ? '(请选择日期)' : '永久有效';
    return new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  const handleFinish = async (values: {
    tenantName: string;
    plan: 'basic' | 'pro' | 'enterprise';
    tenantEmail: string;
    tenantUsername: string;
    tenantPassword: string;
    tenantFullName?: string;
  }) => {
    setSubmitting(true);
    try {
      const payload = { ...values, expiresAt: computeExpiresAt(expireMode) };
      const res = await api.post<{ licenseKey: string }>('/admin/licenses', payload);
      setGeneratedKey(res.data.licenseKey);
      setGeneratedInfo({ email: values.tenantEmail, password: values.tenantPassword });
      form.resetFields();
      setExpireMode('1y');
      setCustomExpireDate('');
    } catch (err) {
      message.error(extractErrorMessage(err, '创建失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setGeneratedKey(null);
    setGeneratedInfo(null);
    form.resetFields();
    onClose();
    if (generatedKey) onDone();
  };

  return (
    <Modal
      title="创建新租户"
      open={open}
      onCancel={handleClose}
      footer={null}
      destroyOnClose
      width={560}
    >
      {generatedKey ? (
        <>
          <Alert
            type="success"
            showIcon
            message="租户创建成功"
            description="请把下列信息一起发给客户 (License Key + 邮箱 + 密码). 客户激活时自动建本地 admin 账号, 用这套邮箱密码直接登录."
            style={{ marginBottom: 16 }}
          />
          <Card size="small" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>License Key</div>
            <Paragraph copyable={{ text: generatedKey }} style={{ marginBottom: 8 }}>
              <code style={{ fontSize: 16, fontWeight: 600 }}>{generatedKey}</code>
            </Paragraph>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>登录邮箱</div>
            <Paragraph copyable={{ text: generatedInfo?.email }} style={{ marginBottom: 8 }}>
              <code>{generatedInfo?.email}</code>
            </Paragraph>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>初始密码</div>
            <Paragraph copyable={{ text: generatedInfo?.password }} style={{ marginBottom: 0 }}>
              <code>{generatedInfo?.password}</code>
            </Paragraph>
          </Card>
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12, fontSize: 12 }}
            message="⚠ 关闭后密码不再显示 · 请务必先复制"
          />
          <Button type="primary" block onClick={handleClose}>
            完成
          </Button>
        </>
      ) : (
        <Form form={form} layout="vertical" onFinish={handleFinish} requiredMark={false}>
          <Form.Item
            label="租户名称 (公司/品牌名)"
            name="tenantName"
            rules={[{ required: true, message: '请输入租户名称' }]}
          >
            <Input placeholder="Acme Sdn Bhd" />
          </Form.Item>
          <Form.Item
            label="套餐"
            name="plan"
            rules={[{ required: true, message: '请选择套餐' }]}
          >
            <Select
              placeholder="选择套餐"
              options={[
                { value: 'basic', label: 'Basic · 10 槽' },
                { value: 'pro', label: 'Pro · 30 槽' },
                { value: 'enterprise', label: 'Enterprise · 50 槽' },
              ]}
            />
          </Form.Item>

          <div style={{ margin: '16px -24px 8px', padding: '4px 24px', background: '#fafafa', fontSize: 12, color: '#666' }}>
            租户 admin 账号 (客户用这套登录)
          </div>

          <Form.Item
            label="管理员邮箱"
            name="tenantEmail"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '邮箱格式错误' },
            ]}
          >
            <Input placeholder="admin@acme.com" autoComplete="off" />
          </Form.Item>
          <Form.Item
            label="管理员用户名"
            name="tenantUsername"
            rules={[
              { required: true, message: '请输入用户名' },
              { pattern: /^[a-zA-Z0-9_]+$/, message: '只能字母/数字/下划线' },
              { min: 3, message: '至少 3 位' },
            ]}
          >
            <Input placeholder="acme_admin" autoComplete="off" name="tenant-username-new" />
          </Form.Item>
          <Form.Item
            label="初始密码"
            name="tenantPassword"
            rules={[
              { required: true, message: '请设置密码' },
              { min: 8, message: '密码至少 8 位' },
            ]}
            extra="发给客户首次登录用 · 客户登入后可自行改"
          >
            <Input.Password placeholder="至少 8 位" autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            label="姓名 / 显示名 (选填)"
            name="tenantFullName"
          >
            <Input placeholder="张三" />
          </Form.Item>

          <Form.Item label="License 有效期" required>
            <Radio.Group
              value={expireMode}
              onChange={(e) => setExpireMode(e.target.value)}
              style={{ marginBottom: 8 }}
              buttonStyle="solid"
            >
              <Radio.Button value="1m">1 个月</Radio.Button>
              <Radio.Button value="3m">3 个月</Radio.Button>
              <Radio.Button value="6m">半年</Radio.Button>
              <Radio.Button value="1y">1 年</Radio.Button>
              <Radio.Button value="never">永久</Radio.Button>
              <Radio.Button value="custom">自选日期</Radio.Button>
            </Radio.Group>
            {expireMode === 'custom' && (
              <Input
                type="date"
                value={customExpireDate}
                onChange={(e) => setCustomExpireDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
                style={{ display: 'block', marginBottom: 4 }}
              />
            )}
            <div style={{ fontSize: 12, color: '#666' }}>
              到期日: <strong style={{ color: expireMode === 'never' ? '#25d366' : '#1677ff' }}>{previewText()}</strong>
            </div>
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={submitting} block>
              创建租户 + 生成 License
            </Button>
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
}

// ── 用户 ─────────────────────────────────────────────────
function UsersTab() {
  const [data, setData] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ items: UserRow[]; meta: unknown }>('/users');
      setData(res.data.items);
    } catch (err) {
      setError(extractErrorMessage(err, '加载用户失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const columns: ColumnsType<UserRow> = [
    { title: '邮箱', dataIndex: 'email' },
    { title: '用户名', dataIndex: 'username' },
    {
      title: '租户',
      dataIndex: 'tenantId',
      render: (v: number | null) => (v === null ? <Tag>平台超管</Tag> : `#${v}`),
    },
    {
      title: '角色',
      dataIndex: 'role',
      render: (r: UserRow['role']) => (
        <Tag color={r === 'admin' ? 'red' : r === 'operator' ? 'blue' : 'default'}>{r}</Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      render: (s: string) => <Tag color={s === 'active' ? 'success' : 'error'}>{s}</Tag>,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
  ];

  return (
    <Card
      size="small"
      extra={<Button size="small" onClick={() => void load()} loading={loading}>刷新</Button>}
    >
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 12 }} />}
      <Table
        rowKey="id"
        dataSource={data}
        columns={columns}
        loading={loading}
        pagination={{ pageSize: 20 }}
        size="small"
      />
    </Card>
  );
}
