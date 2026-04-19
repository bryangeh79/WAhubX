import { useCallback, useEffect, useState } from 'react';
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
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message as antdMessage,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { api, extractErrorMessage } from '@/lib/api';

const { Text, Paragraph } = Typography;

type ProviderType = 'openai' | 'deepseek' | 'custom_openai_compat' | 'gemini' | 'claude';

interface ProviderRow {
  id: number;
  providerType: ProviderType;
  name: string;
  model: string;
  baseUrl: string;
  apiKeyMasked: string;
  enabled: boolean;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
}

const PROVIDER_TYPES: Array<{ value: ProviderType; label: string; hint?: string }> = [
  { value: 'openai', label: 'OpenAI', hint: 'https://api.openai.com/v1' },
  { value: 'deepseek', label: 'DeepSeek', hint: 'https://api.deepseek.com/v1' },
  { value: 'custom_openai_compat', label: 'Custom OpenAI-Compat', hint: 'Ollama / SiliconFlow / Azure / OpenRouter' },
  { value: 'gemini', label: 'Gemini (M6 未实装)' },
  { value: 'claude', label: 'Claude (M6 未实装)' },
];

const GOTCHA_TOOLTIP = (
  <div style={{ maxWidth: 400, lineHeight: 1.5 }}>
    <Paragraph style={{ color: '#fff', marginBottom: 6 }}>
      <strong>备份与迁移注意 (M6 安全模型)</strong>
    </Paragraph>
    <ul style={{ paddingLeft: 16, margin: 0, color: '#ddd', fontSize: 12 }}>
      <li>API key 以 AES-256-GCM 密文存 DB, 主密钥来自 env <code>APP_ENCRYPTION_KEY</code></li>
      <li>DB 备份 <strong>含</strong> 加密密文; 主密钥必须单独备份 (或 M10 派生自机器指纹)</li>
      <li>.wab 导出 <strong>不含</strong> 主密钥 (§B.11). 换机/换指纹后用户需重填所有 API key</li>
      <li>轮换主密钥 = 使所有现有 provider 密文失效, 需重录</li>
    </ul>
  </div>
);

export function AiTab() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [textEnabled, setTextEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [testResult, setTestResult] = useState<{
    id: number;
    ok: boolean;
    latencyMs: number;
    message?: string;
    error?: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, s] = await Promise.all([
        api.get<ProviderRow[]>('/ai-providers'),
        api.get<Record<string, string>>('/ai-settings'),
      ]);
      setProviders(p.data);
      setTextEnabled(s.data.text_enabled === 'true');
    } catch (err) {
      setError(extractErrorMessage(err, '加载 AI 配置失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleTextEnabled = async (v: boolean) => {
    try {
      await api.post('/ai-settings/text-enable', { enabled: v });
      setTextEnabled(v);
      antdMessage.success(v ? 'AI 文本改写已启用' : '已关闭');
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '切换失败'));
    }
  };

  const testProvider = async (id: number) => {
    try {
      const res = await api.post<{
        ok: boolean;
        latencyMs: number;
        message?: string;
        error?: string;
      }>(`/ai-providers/${id}/test`);
      setTestResult({ id, ...res.data });
      await load();
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '测试失败'));
    }
  };

  const remove = async (id: number) => {
    try {
      await api.delete(`/ai-providers/${id}`);
      antdMessage.success('已删除');
      await load();
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '删除失败'));
    }
  };

  const toggle = async (row: ProviderRow, enabled: boolean) => {
    try {
      await api.patch(`/ai-providers/${row.id}`, { enabled });
      await load();
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '切换失败'));
    }
  };

  const cols: ColumnsType<ProviderRow> = [
    {
      title: '类型',
      dataIndex: 'providerType',
      render: (t: ProviderType) => {
        const info = PROVIDER_TYPES.find((x) => x.value === t);
        const skel = t === 'gemini' || t === 'claude';
        return <Tag color={skel ? 'default' : 'blue'}>{info?.label ?? t}</Tag>;
      },
    },
    { title: '名称', dataIndex: 'name' },
    { title: '模型', dataIndex: 'model', render: (m) => <Text code>{m}</Text> },
    { title: 'Base URL', dataIndex: 'baseUrl', render: (u) => <Text style={{ fontSize: 11 }}>{u}</Text> },
    {
      title: 'API Key',
      dataIndex: 'apiKeyMasked',
      render: (k) => <Text code style={{ fontSize: 11 }}>{k}</Text>,
    },
    {
      title: '最近测试',
      render: (_, r) =>
        r.lastTestedAt ? (
          r.lastTestOk ? (
            <Tag color="green">✓ OK</Tag>
          ) : (
            <Tooltip title={r.lastTestError ?? ''}>
              <Tag color="red">✗ {r.lastTestError?.slice(0, 30) ?? 'fail'}</Tag>
            </Tooltip>
          )
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 70,
      render: (v, r) => <Switch size="small" checked={v} onChange={(nv) => void toggle(r, nv)} />,
    },
    {
      title: '',
      width: 160,
      render: (_, r) => (
        <Space size={4}>
          <Button size="small" onClick={() => void testProvider(r.id)}>测试</Button>
          <Popconfirm title={`删除 ${r.name}?`} onConfirm={() => void remove(r.id)}>
            <Button size="small" danger>删</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      {error && <Alert type="error" message={error} showIcon />}
      <Alert
        type="info"
        showIcon
        message={
          <Space>
            <Text>全局 AI 文本改写</Text>
            <Switch checked={textEnabled} onChange={(v) => void toggleTextEnabled(v)} />
            <Text type="secondary">
              {textEnabled
                ? 'ScriptRunner miss 时走 AI · 失败自动降级 content_pool'
                : 'ScriptRunner 永走 content_pool (§B.4 降级矩阵: AI 关)'}
            </Text>
            <Tooltip title={GOTCHA_TOOLTIP} placement="right" overlayStyle={{ maxWidth: 420 }}>
              <Text style={{ cursor: 'help' }}>ℹ️ 备份/迁移注意</Text>
            </Tooltip>
          </Space>
        }
      />
      <Card
        size="small"
        title={`AI Providers (${providers.length})`}
        extra={
          <Space>
            <Button onClick={load} loading={loading} size="small">刷新</Button>
            <Button type="primary" size="small" onClick={() => setCreateOpen(true)}>
              新增
            </Button>
          </Space>
        }
      >
        <Table size="small" rowKey="id" dataSource={providers} columns={cols} pagination={false} />
      </Card>

      <CreateModal open={createOpen} onClose={() => setCreateOpen(false)} onDone={load} />

      <Modal
        title="连通性测试结果"
        open={!!testResult}
        onCancel={() => setTestResult(null)}
        footer={null}
      >
        {testResult && (
          <>
            {testResult.ok ? (
              <Alert type="success" showIcon message={`✓ 连通 · ${testResult.latencyMs}ms`} />
            ) : (
              <Alert type="error" showIcon message={`✗ 失败 · ${testResult.error}`} description={testResult.message} />
            )}
          </>
        )}
      </Modal>
    </Space>
  );
}

function CreateModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await api.post('/ai-providers', values);
      antdMessage.success('已创建');
      form.resetFields();
      onClose();
      onDone();
    } catch (err) {
      if ((err as { errorFields?: unknown }).errorFields) return; // validation
      antdMessage.error(extractErrorMessage(err, '创建失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="新增 AI Provider" open={open} onCancel={onClose} onOk={submit} confirmLoading={saving}>
      <Form form={form} layout="vertical" initialValues={{ enabled: true }}>
        <Form.Item name="providerType" label="类型" rules={[{ required: true }]}>
          <Select
            options={PROVIDER_TYPES.map((p) => ({
              value: p.value,
              label: (
                <Space direction="vertical" size={0}>
                  <Text>{p.label}</Text>
                  {p.hint && <Text type="secondary" style={{ fontSize: 11 }}>{p.hint}</Text>}
                </Space>
              ),
            }))}
          />
        </Form.Item>
        <Form.Item name="name" label="名称" rules={[{ required: true }]}>
          <Input placeholder="e.g. deepseek-chat-dev" />
        </Form.Item>
        <Form.Item name="model" label="模型 ID" rules={[{ required: true }]}>
          <Input placeholder="gpt-4o-mini / deepseek-chat / llama3.2:1b" />
        </Form.Item>
        <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true }]}>
          <Input placeholder="https://api.openai.com/v1" />
        </Form.Item>
        <Form.Item name="apiKey" label="API Key" rules={[{ required: true, min: 4 }]}>
          <Input.Password placeholder="sk-..." autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
