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

const { Text } = Typography;

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

interface ProviderMeta {
  value: ProviderType;
  label: string;
  hint?: string;
  baseUrl: string;
  models: Array<{ value: string; label: string; desc?: string }>;
  allowCustomModel?: boolean;
}

const PROVIDER_TYPES: ProviderMeta[] = [
  {
    value: 'openai',
    label: 'OpenAI',
    hint: 'https://api.openai.com/v1',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { value: 'gpt-4o-mini', label: 'gpt-4o-mini', desc: '推荐 · 便宜快 · 适合文案改写' },
      { value: 'gpt-4o', label: 'gpt-4o', desc: '质量最好 · 贵' },
      { value: 'gpt-4-turbo', label: 'gpt-4-turbo', desc: '老旗舰' },
      { value: 'gpt-3.5-turbo', label: 'gpt-3.5-turbo', desc: '最便宜 · 质量一般' },
    ],
  },
  {
    value: 'deepseek',
    label: 'DeepSeek',
    hint: 'https://api.deepseek.com/v1 · 国产性价比 · 推荐',
    baseUrl: 'https://api.deepseek.com/v1',
    models: [
      { value: 'deepseek-chat', label: 'deepseek-chat', desc: '推荐 · 通用对话 · 中文好' },
      { value: 'deepseek-reasoner', label: 'deepseek-reasoner', desc: '推理增强 · 稍慢稍贵' },
    ],
  },
  {
    value: 'gemini',
    label: 'Gemini',
    hint: 'https://generativelanguage.googleapis.com/v1beta · Google · 有免费额度',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: [
      { value: 'gemini-2.0-flash-exp', label: 'gemini-2.0-flash-exp', desc: '推荐 · 最新 · 免费额度大' },
      { value: 'gemini-1.5-flash', label: 'gemini-1.5-flash', desc: '便宜快 · 稳定版' },
      { value: 'gemini-1.5-flash-8b', label: 'gemini-1.5-flash-8b', desc: '最便宜 · 小模型' },
      { value: 'gemini-1.5-pro', label: 'gemini-1.5-pro', desc: '质量更好 · 贵' },
    ],
  },
  {
    value: 'claude',
    label: 'Claude (M6 未实装)',
    hint: 'adapter 骨架 · 运行时会 NOT_IMPLEMENTED 降级',
    baseUrl: 'https://api.anthropic.com/v1',
    models: [
      { value: 'claude-3-5-haiku-20241022', label: 'claude-3-5-haiku', desc: '便宜快' },
      { value: 'claude-3-5-sonnet-20241022', label: 'claude-3-5-sonnet', desc: '旗舰' },
    ],
  },
  {
    value: 'custom_openai_compat',
    label: 'Custom OpenAI-Compat',
    hint: 'Ollama / SiliconFlow / Azure / OpenRouter 等自定义 endpoint',
    baseUrl: 'http://localhost:11434/v1',
    models: [
      { value: 'llama3.2:1b', label: 'llama3.2:1b (Ollama)' },
      { value: 'llama3.2:3b', label: 'llama3.2:3b (Ollama)' },
      { value: 'qwen2.5:7b', label: 'qwen2.5:7b (Ollama · 中文好)' },
    ],
    allowCustomModel: true,
  },
];

const GOTCHA_TOOLTIP = (
  <div style={{ maxWidth: 340, lineHeight: 1.6, fontSize: 12 }}>
    <div style={{ color: '#fff', marginBottom: 6, fontWeight: 600 }}>API Key 安全</div>
    <ul style={{ paddingLeft: 16, margin: 0, color: '#ddd' }}>
      <li>Key 加密存本机, 不会上传云端</li>
      <li>换电脑 / 还原备份后 · 需要重新填入 API Key</li>
      <li>你看到的列表里 Key 已脱敏, 原文无法再读出</li>
    </ul>
  </div>
);

export function AiTab() {
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [textEnabled, setTextEnabled] = useState(false);
  const [marketingPrompt, setMarketingPrompt] = useState('');
  const [marketingPromptDirty, setMarketingPromptDirty] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);
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
      setMarketingPrompt(s.data.marketing_system_prompt ?? '');
      setMarketingPromptDirty(false);
    } catch (err) {
      setError(extractErrorMessage(err, '加载 AI 配置失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const savePrompt = async () => {
    setSavingPrompt(true);
    try {
      await api.post('/ai-settings/marketing-prompt', { prompt: marketingPrompt });
      antdMessage.success('人设已保存 · 后续 AI 生成变体即用新人设');
      setMarketingPromptDirty(false);
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '保存失败'));
    } finally {
      setSavingPrompt(false);
    }
  };

  const resetPrompt = async () => {
    setSavingPrompt(true);
    try {
      const res = await api.post<{ marketing_system_prompt: string }>(
        '/ai-settings/marketing-prompt/reset',
        {},
      );
      setMarketingPrompt(res.data.marketing_system_prompt);
      setMarketingPromptDirty(false);
      antdMessage.success('已恢复默认人设');
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '重置失败'));
    } finally {
      setSavingPrompt(false);
    }
  };

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
      <div
        style={{
          border: '1px solid #e8e8e8',
          borderRadius: 8,
          padding: '16px 20px',
          background: '#fafafa',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 8,
          }}
        >
          <Space>
            <Text style={{ fontSize: 14, fontWeight: 600 }}>AI 文本改写 · 总开关</Text>
            <Tooltip title={GOTCHA_TOOLTIP} placement="right" overlayStyle={{ maxWidth: 360 }}>
              <Text style={{ cursor: 'help', color: '#8c8c8c', fontSize: 12 }}>
                ⓘ 关于 API Key
              </Text>
            </Tooltip>
          </Space>
          <Switch checked={textEnabled} onChange={(v) => void toggleTextEnabled(v)} />
        </div>
        <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.6 }}>
          {textEnabled
            ? '已开启 · 系统会用 AI 为聊天 / 广告文案自动生成多样化变体 · 降低封号风险'
            : '已关闭 · 聊天 / 广告统一使用你填写的原文 · 不调 AI'}
        </Text>
      </div>
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

      {/* 2026-04-24 · AI 营销人设 (广告 + 开场白 AI 变体用) */}
      <Card
        size="small"
        title={
          <Space>
            <span>AI 营销人设</span>
            <Text type="secondary" style={{ fontWeight: 400, fontSize: 12 }}>
              · 广告 / 开场白 AI 生成变体时注入 system prompt
            </Text>
          </Space>
        }
        extra={
          <Space>
            <Button size="small" onClick={resetPrompt} loading={savingPrompt}>
              恢复默认
            </Button>
            <Button
              type="primary"
              size="small"
              onClick={savePrompt}
              loading={savingPrompt}
              disabled={!marketingPromptDirty}
              style={{ background: '#25d366', borderColor: '#25d366' }}
            >
              保存
            </Button>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          message="在这里定义 AI 生成广告 / 开场白变体时的角色、风格、规则. 修改立即生效, 下次生成变体就用新人设."
          style={{ marginBottom: 12, fontSize: 12 }}
        />
        <Input.TextArea
          value={marketingPrompt}
          onChange={(e) => {
            setMarketingPrompt(e.target.value);
            setMarketingPromptDirty(true);
          }}
          rows={18}
          placeholder="留空会用系统默认人设 · 包含保留联系方式的硬规则"
          style={{ fontFamily: 'ui-monospace, Consolas, Menlo, monospace', fontSize: 12 }}
          maxLength={8000}
          showCount
        />
        {marketingPromptDirty && (
          <Text type="warning" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
            ⚠ 有未保存的修改 · 点"保存"生效
          </Text>
        )}
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
  const [selectedType, setSelectedType] = useState<ProviderType>('deepseek');

  const meta = PROVIDER_TYPES.find((p) => p.value === selectedType) ?? PROVIDER_TYPES[0];

  const onTypeChange = (t: ProviderType) => {
    setSelectedType(t);
    const next = PROVIDER_TYPES.find((p) => p.value === t);
    if (!next) return;
    // 类型切换时自动填 baseUrl + 默认选第 1 个 model
    form.setFieldsValue({
      baseUrl: next.baseUrl,
      model: next.models[0]?.value ?? '',
    });
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const providerType: ProviderType = values.providerType;
      // tags 模式返数组, 取第一个; 普通 select 是 string
      const model: string = Array.isArray(values.model) ? values.model[0] : values.model;
      if (!model) {
        antdMessage.error('请选择或输入模型');
        setSaving(false);
        return;
      }
      const meta = PROVIDER_TYPES.find((p) => p.value === providerType);
      // 自动生成 name: {类型 label} · {model}
      const autoName = `${meta?.label ?? providerType} · ${model}`;
      await api.post('/ai-providers', {
        providerType: values.providerType,
        baseUrl: values.baseUrl,
        apiKey: values.apiKey,
        model,
        name: autoName,
      });
      antdMessage.success('已创建');
      form.resetFields();
      setSelectedType('deepseek');
      onClose();
      onDone();
    } catch (err) {
      if ((err as { errorFields?: unknown }).errorFields) return; // validation
      antdMessage.error(extractErrorMessage(err, '创建失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleOpenChange = () => {
    if (open) {
      const init = PROVIDER_TYPES.find((p) => p.value === 'deepseek') ?? PROVIDER_TYPES[0];
      form.setFieldsValue({
        providerType: init.value,
        baseUrl: init.baseUrl,
        model: init.models[0]?.value ?? '',
      });
      setSelectedType(init.value);
    }
  };

  useEffect(() => {
    handleOpenChange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Modal
      title="新增 AI Provider"
      open={open}
      onCancel={onClose}
      onOk={submit}
      confirmLoading={saving}
      okText="确定"
      cancelText="取消"
      destroyOnHidden
    >
      <Form form={form} layout="vertical" initialValues={{ enabled: true }}>
        <Form.Item name="providerType" label="类型" rules={[{ required: true }]}>
          <Select
            onChange={(v: ProviderType) => onTypeChange(v)}
            options={PROVIDER_TYPES.map((p) => ({ value: p.value, label: p.label }))}
            optionRender={(option) => {
              const p = PROVIDER_TYPES.find((x) => x.value === option.value);
              if (!p) return option.label;
              return (
                <div style={{ padding: '4px 0' }}>
                  <div style={{ fontWeight: 500 }}>{p.label}</div>
                  {p.hint && (
                    <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 2 }}>{p.hint}</div>
                  )}
                </div>
              );
            }}
          />
        </Form.Item>

        <Form.Item name="model" label="模型" rules={[{ required: true, message: '请选择模型' }]}>
          <Select
            showSearch={meta.allowCustomModel}
            optionFilterProp="label"
            {...(meta.allowCustomModel
              ? {
                  mode: 'tags' as const,
                  maxTagCount: 1,
                  tokenSeparators: [','],
                }
              : {})}
            placeholder={
              meta.allowCustomModel ? '选或输入自定义 model id' : `选择 ${meta.label} 模型`
            }
            options={meta.models.map((m) => ({ value: m.value, label: m.label }))}
            optionRender={(option) => {
              const m = meta.models.find((x) => x.value === option.value);
              if (!m) return option.label;
              return (
                <div style={{ padding: '4px 0' }}>
                  <div style={{ fontWeight: 500 }}>{m.label}</div>
                  {m.desc && (
                    <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 2 }}>{m.desc}</div>
                  )}
                </div>
              );
            }}
          />
        </Form.Item>

        <Form.Item
          name="baseUrl"
          label="Base URL"
          rules={[{ required: true }]}
          extra={
            <Text type="secondary" style={{ fontSize: 11 }}>
              通常不用改 · 切换类型自动填默认值
            </Text>
          }
        >
          <Input />
        </Form.Item>

        <Form.Item
          name="apiKey"
          label="API Key"
          rules={[{ required: true, min: 4, message: 'API Key 至少 4 位' }]}
        >
          <Input.Password placeholder="sk-..." autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
