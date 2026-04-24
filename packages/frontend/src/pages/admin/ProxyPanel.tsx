// 2026-04-22 · 代理 (VPN) 完整管理 UI
// 加 / 编辑 / 测速 / 删除 · 显示占用槽位数 · 延迟 / egress IP
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { api, extractErrorMessage } from '@/lib/api';

const { Text } = Typography;

interface ProxyItem {
  id: number;
  tenantId: number;
  proxyType: string;
  host: string;
  port: number;
  username: string | null;
  password: string | null;
  country: string | null;
  city: string | null;
  status: 'ok' | 'down' | 'unknown';
  avgLatencyMs: number | null;
  lastCheckAt: string | null;
  boundSlotIds: number[];
  inUseCount?: number;
  inUseSlotIndexes?: number[];
}

const PROTOCOL_OPTIONS = [
  { value: 'socks5', label: 'SOCKS5 (推荐)' },
  { value: 'http', label: 'HTTP' },
  { value: 'https', label: 'HTTPS' },
  { value: 'socks4', label: 'SOCKS4' },
  { value: 'residential_static', label: '住宅静态 (未指定协议 · 走 HTTP)' },
  { value: 'residential_rotating', label: '住宅动态 (未指定协议 · 走 HTTP)' },
  { value: 'datacenter', label: '数据中心 (未指定协议 · 走 HTTP)' },
];

const STATUS_META: Record<string, { color: string; label: string }> = {
  ok: { color: 'green', label: '✅ 在线' },
  down: { color: 'red', label: '❌ 离线' },
  unknown: { color: 'default', label: '⏳ 未测' },
};

export function ProxyPanel() {
  const [list, setList] = useState<ProxyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<ProxyItem | 'new' | null>(null);
  const [testingIds, setTestingIds] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<ProxyItem[]>('/admin/proxies');
      setList(r.data);
    } catch (err) {
      message.error(extractErrorMessage(err, '加载代理列表失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleTest = async (id: number) => {
    const next = new Set(testingIds);
    next.add(id);
    setTestingIds(next);
    try {
      const r = await api.post<{ ok: boolean; latencyMs: number; egressIp: string | null; error: string | null }>(
        `/admin/proxies/${id}/test`,
      );
      if (r.data.ok) {
        message.success(
          `✅ 代理 #${id} · 延迟 ${r.data.latencyMs}ms · 出口 IP ${r.data.egressIp ?? '?'}`,
          5,
        );
      } else {
        message.error(`❌ 代理 #${id} 测试失败: ${r.data.error ?? '超时'}`, 5);
      }
      void load();
    } catch (err) {
      message.error(extractErrorMessage(err, '测速失败'));
    } finally {
      const rm = new Set(testingIds);
      rm.delete(id);
      setTestingIds(rm);
    }
  };

  const handleTestAll = async () => {
    if (list.length === 0) return;
    message.info(`开始并发测速 ${list.length} 个代理...`);
    await Promise.all(list.map((p) => handleTest(p.id)));
    message.success('全部测速完成');
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/admin/proxies/${id}`);
      message.success('已删除');
      void load();
    } catch (err) {
      message.error(extractErrorMessage(err));
    }
  };

  const columns: ColumnsType<ProxyItem> = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    {
      title: '类型',
      dataIndex: 'proxyType',
      width: 110,
      render: (v: string) => <Tag>{v.toUpperCase()}</Tag>,
    },
    {
      title: '出口',
      width: 220,
      render: (_, r) => (
        <Text copyable={{ text: `${r.host}:${r.port}` }}>
          {r.host}:{r.port}
        </Text>
      ),
    },
    {
      title: '国家 / 城市',
      width: 130,
      render: (_, r) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {r.country ?? '—'}
          {r.city && ` · ${r.city}`}
        </Text>
      ),
    },
    {
      title: '认证',
      width: 90,
      render: (_, r) =>
        r.username ? (
          <Tag color="blue" style={{ fontSize: 11 }}>
            {r.username}
          </Tag>
        ) : (
          <Text type="secondary" style={{ fontSize: 11 }}>
            无
          </Text>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s: string) => <Tag color={STATUS_META[s]?.color ?? 'default'}>{STATUS_META[s]?.label ?? s}</Tag>,
    },
    {
      title: '延迟',
      dataIndex: 'avgLatencyMs',
      width: 90,
      render: (v: number | null) => {
        if (v === null) return <Text type="secondary">—</Text>;
        const color = v > 2000 ? 'red' : v > 500 ? 'orange' : 'green';
        return <Tag color={color}>{v} ms</Tag>;
      },
    },
    {
      title: '占用槽位',
      dataIndex: 'inUseSlotIndexes',
      width: 140,
      render: (indexes: number[] | undefined) => {
        const list = indexes ?? [];
        if (list.length === 0) return <Text type="secondary">空闲</Text>;
        return (
          <Tooltip title={`正在被 ${list.length} 个槽位使用`}>
            <Space size={2} wrap>
              {list.map((i) => (
                <Tag key={i} color="purple" style={{ marginInlineEnd: 0 }}>
                  #{i}
                </Tag>
              ))}
            </Space>
          </Tooltip>
        );
      },
    },
    {
      title: '操作',
      width: 220,
      render: (_, r) => (
        <Space size={4}>
          <Button
            size="small"
            type="link"
            loading={testingIds.has(r.id)}
            onClick={() => void handleTest(r.id)}
          >
            🔍 测速
          </Button>
          <Button size="small" type="link" onClick={() => setEditing(r)}>
            ✏ 编辑
          </Button>
          <Popconfirm
            title={r.inUseCount && r.inUseCount > 0 ? `已被 ${r.inUseCount} 号占用 · 不可删` : '确认删除?'}
            disabled={(r.inUseCount ?? 0) > 0}
            onConfirm={() => void handleDelete(r.id)}
            okText="删"
            cancelText="否"
          >
            <Button size="small" type="link" danger disabled={(r.inUseCount ?? 0) > 0}>
              🗑 删
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title="代理 / VPN 管理"
      extra={
        <Space>
          <Button size="small" onClick={handleTestAll} disabled={list.length === 0}>
            🔍 全部测速
          </Button>
          <Button size="small" type="primary" onClick={() => setEditing('new')}>
            ➕ 添加代理
          </Button>
          <Button size="small" onClick={() => void load()} loading={loading}>
            刷新
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="代理工作流"
        description={
          <Text style={{ fontSize: 12 }}>
            1️⃣ 在这里先加代理 → 2️⃣ 绑号 / 新号注册时 "选择代理" 下拉里选 → 3️⃣ 槽位运行后如需换代理 · 槽位卡上随时可改.
            <br />
            推荐: SOCKS5 协议 · 住宅 IP · 国家和手机号归属地一致 (避免 WA 风控).
          </Text>
        }
      />
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={list}
        pagination={false}
        locale={{ emptyText: '还没有代理 · 点"添加代理"开始' }}
      />

      {editing && (
        <ProxyEditorModal
          open={!!editing}
          target={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </Card>
  );
}

interface CountryOption {
  code: string;
  callingCode: string;
  flag: string;
  name: string;
}

function ProxyEditorModal({
  open,
  target,
  onClose,
  onSaved,
}: {
  open: boolean;
  target: ProxyItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [countries, setCountries] = useState<CountryOption[]>([]);

  useEffect(() => {
    if (!open) return;
    api
      .get<CountryOption[]>('/slots/sim-info/telco-registry')
      .then((r) => setCountries(r.data))
      .catch(() => {
        /* 非关键 */
      });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (target) {
      form.setFieldsValue({
        proxyType: target.proxyType,
        host: target.host,
        port: target.port,
        username: target.username ?? '',
        password: target.password ?? '',
        country: target.country ?? '',
        city: target.city ?? '',
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ proxyType: 'socks5' });
    }
  }, [open, target, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload = {
        ...values,
        username: values.username || null,
        password: values.password || null,
        country: values.country?.toUpperCase() || null,
        city: values.city || null,
      };
      if (target) {
        await api.patch(`/admin/proxies/${target.id}`, payload);
        message.success('已更新');
      } else {
        await api.post('/admin/proxies', payload);
        message.success('已添加');
      }
      onSaved();
    } catch (err) {
      if ((err as { errorFields?: unknown }).errorFields) return;
      message.error(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={handleOk}
      confirmLoading={saving}
      title={target ? `✏ 编辑代理 #${target.id}` : '➕ 添加代理'}
      okText="保存"
      cancelText="取消"
      width={520}
      destroyOnClose
    >
      <Form form={form} layout="vertical" size="small">
        <Form.Item label="协议类型" name="proxyType" rules={[{ required: true }]}>
          <Select options={PROTOCOL_OPTIONS} />
        </Form.Item>
        <Form.Item label="主机 / IP" name="host" rules={[{ required: true, message: '必填' }]}>
          <Input placeholder="例: proxy.example.com 或 1.2.3.4" />
        </Form.Item>
        <Form.Item label="端口" name="port" rules={[{ required: true, message: '必填' }]}>
          <InputNumber min={1} max={65535} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="用户名 (选填)" name="username">
          <Input placeholder="没有认证则留空" />
        </Form.Item>
        <Form.Item label="密码 (选填)" name="password">
          <Input.Password placeholder="没有认证则留空" />
        </Form.Item>
        <Form.Item
          label="国家 (选填)"
          name="country"
          extra="推荐填 · 用于和 SIM 一致性风控 · 不在列表里可先留空 · 不影响功能"
        >
          <Select
            showSearch
            allowClear
            placeholder="选国家 · 可输入搜索"
            optionFilterProp="label"
            options={countries.map((c) => ({
              value: c.code,
              label: `${c.flag} ${c.name} (${c.code} · +${c.callingCode})`,
            }))}
          />
        </Form.Item>
        <Form.Item label="城市 (选填)" name="city">
          <Input placeholder="Kuala Lumpur" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
