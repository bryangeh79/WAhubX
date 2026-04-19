import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
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
function LicensesTab() {
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
              + 生成 License
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

  const handleFinish = async (values: {
    tenantName: string;
    plan: 'basic' | 'pro' | 'enterprise';
    tenantEmail?: string;
    expiresAt?: string;
  }) => {
    setSubmitting(true);
    try {
      const res = await api.post<{ licenseKey: string }>('/admin/licenses', values);
      setGeneratedKey(res.data.licenseKey);
      form.resetFields();
    } catch (err) {
      message.error(extractErrorMessage(err, '生成失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setGeneratedKey(null);
    form.resetFields();
    onClose();
    if (generatedKey) onDone();
  };

  return (
    <Modal
      title="生成 License"
      open={open}
      onCancel={handleClose}
      footer={null}
      destroyOnClose
    >
      {generatedKey ? (
        <>
          <Alert
            type="success"
            showIcon
            message="生成成功"
            description="请立即复制下面的 License Key 给客户. 关闭后无法再次查看完整 Key (在列表里只显示缩略)."
            style={{ marginBottom: 16 }}
          />
          <Paragraph copyable={{ text: generatedKey }}>
            <code style={{ fontSize: 16, fontWeight: 600 }}>{generatedKey}</code>
          </Paragraph>
          <Button type="primary" block onClick={handleClose}>
            完成
          </Button>
        </>
      ) : (
        <Form form={form} layout="vertical" onFinish={handleFinish} requiredMark={false}>
          <Form.Item
            label="租户名称"
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
          <Form.Item
            label="租户邮箱 (选填)"
            name="tenantEmail"
            rules={[{ type: 'email', message: '邮箱格式错误' }]}
          >
            <Input placeholder="billing@acme.com" />
          </Form.Item>
          <Form.Item label="过期时间 (选填, ISO)" name="expiresAt">
            <Input placeholder="2027-04-19T00:00:00Z" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={submitting} block>
              生成
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
