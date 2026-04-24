// 2026-04-21 · 用户要求: 扫码/注册前强制过一次代理选择步骤
// Backend 已就绪 (baileys.service 在 connect 时用 slot.proxy_id 构 agent · 首次 QR WS 就走代理 IP)
// 本 modal 只负责 UI 选 + 调 assignProxy · 成功后交给父组件开扫码流程
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import { api, extractErrorMessage } from '@/lib/api';

const { Text, Paragraph } = Typography;

interface ProxyItem {
  id: number;
  tenantId: number;
  proxyType: 'http' | 'https' | 'socks4' | 'socks5';
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  country: string | null;
  city: string | null;
  status: 'unknown' | 'online' | 'offline';
  avgLatencyMs: number | null;
  lastCheckAt: string | null;
  boundSlotIds: number[];
}

type Mode = 'direct' | 'existing' | 'new';

interface Props {
  slotId: number;
  slotIndex: number;
  currentProxyId: number | null;
  open: boolean;
  onClose: () => void;
  /** 代理已就位 · 父组件可以开始扫码/注册流程 */
  onReady: () => void;
}

export function SelectProxyBeforeBindModal({
  slotId,
  slotIndex,
  currentProxyId,
  open,
  onClose,
  onReady,
}: Props) {
  const [mode, setMode] = useState<Mode>(currentProxyId == null ? 'direct' : 'existing');
  const [proxies, setProxies] = useState<ProxyItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selectedProxyId, setSelectedProxyId] = useState<number | null>(currentProxyId);
  const [submitting, setSubmitting] = useState(false);
  const [newProxyForm] = Form.useForm();

  const loadProxies = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await api.get<ProxyItem[]>('/admin/proxies');
      setProxies(res.data);
    } catch (err) {
      message.error(extractErrorMessage(err, '加载代理列表失败'));
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    if (open) void loadProxies();
  }, [open, loadProxies]);

  const proxyOptions = useMemo(
    () =>
      proxies.map((p) => {
        const latency = p.avgLatencyMs ?? null;
        const offline = p.status === 'offline';
        const label = (
          <Space>
            <Tag color={offline ? 'red' : p.status === 'online' ? 'green' : 'default'}>
              {p.status}
            </Tag>
            <Text>{p.country ?? '—'}</Text>
            <Text type="secondary">{p.proxyType}://{p.host}:{p.port}</Text>
            {latency !== null && (
              <Tag color={latency > 2000 ? 'red' : latency > 500 ? 'orange' : 'green'}>
                {latency}ms
              </Tag>
            )}
          </Space>
        );
        return {
          value: p.id,
          label,
          disabled: offline,
        };
      }),
    [proxies],
  );

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      let targetProxyId: number | null = null;
      if (mode === 'existing') {
        if (!selectedProxyId) {
          message.warning('请选择一个代理');
          setSubmitting(false);
          return;
        }
        targetProxyId = selectedProxyId;
      } else if (mode === 'new') {
        const values = await newProxyForm.validateFields();
        const created = await api.post<ProxyItem>('/admin/proxies', values);
        targetProxyId = created.data.id;
      }
      // mode === 'direct' → targetProxyId stays null = 不用代理
      await api.patch(`/slots/${slotId}/proxy`, { proxyId: targetProxyId });
      onReady();
      onClose();
    } catch (err) {
      message.error(extractErrorMessage(err, '配置代理失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={`配置代理 · 槽位 #${slotIndex}`}
      width={640}
      footer={[
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button key="ok" type="primary" loading={submitting} onClick={handleSubmit}>
          继续绑定 →
        </Button>,
      ]}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="为账号绑定稳定代理 · 避免 WhatsApp 识别同 IP 多账号触发风控"
        description={
          <Text style={{ fontSize: 12 }}>
            📌 不选代理 = 使用您当前本机 IP (小号/测试 OK, 生产建议配代理)<br />
            📌 推荐每个账号用独立代理, 国家尽量匹配手机号归属地
          </Text>
        }
      />

      <Radio.Group
        value={mode}
        onChange={(e) => setMode(e.target.value as Mode)}
        style={{ display: 'block', marginBottom: 16 }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Radio value="direct">
            <Text strong>不用代理 (使用当前 IP)</Text>
          </Radio>
          <Radio value="existing">
            <Text strong>使用已有代理</Text>
          </Radio>
          <Radio value="new">
            <Text strong>添加新代理</Text>
          </Radio>
        </Space>
      </Radio.Group>

      {mode === 'existing' && (
        loadingList ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <Spin />
          </div>
        ) : proxies.length === 0 ? (
          <Alert
            type="warning"
            message="租户下还没有代理 · 请选择'添加新代理'或'不用代理'"
          />
        ) : (
          <div>
            <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
              选一个代理 (offline 状态不可选 · 延迟 &gt; 2s 标红不推荐)
            </Paragraph>
            <Select
              style={{ width: '100%' }}
              placeholder="选择代理..."
              value={selectedProxyId ?? undefined}
              onChange={(v) => setSelectedProxyId(v)}
              options={proxyOptions}
              optionLabelProp="label"
            />
          </div>
        )
      )}

      {mode === 'new' && (
        <Form form={newProxyForm} layout="vertical" size="small">
          <Form.Item label="类型" name="proxyType" initialValue="socks5" rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'http', label: 'HTTP' },
                { value: 'https', label: 'HTTPS' },
                { value: 'socks4', label: 'SOCKS4' },
                { value: 'socks5', label: 'SOCKS5' },
              ]}
            />
          </Form.Item>
          <Form.Item label="主机" name="host" rules={[{ required: true, message: '必填' }]}>
            <Input placeholder="例: proxy.example.com 或 1.2.3.4" />
          </Form.Item>
          <Form.Item label="端口" name="port" rules={[{ required: true, message: '必填' }]}>
            <InputNumber min={1} max={65535} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="用户名 (选填)" name="username">
            <Input />
          </Form.Item>
          <Form.Item label="密码 (选填)" name="password">
            <Input.Password />
          </Form.Item>
          <Form.Item label="国家 (ISO 2 字母 · 选填)" name="country">
            <Input placeholder="MY / SG / US ..." maxLength={2} />
          </Form.Item>
          <Form.Item label="城市 (选填)" name="city">
            <Input />
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
}
