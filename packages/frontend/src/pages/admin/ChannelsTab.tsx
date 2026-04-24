// 2026-04-21 · 素材库 · 频道列表 (含官方种子 global + 租户自录)
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { api, extractErrorMessage } from '@/lib/api';
import { useAuth } from '@/auth/AuthContext';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

interface ChannelItem {
  id: number;
  tenantId: number | null;
  global: boolean;
  name: string;
  inviteCode: string | null;
  jid: string | null;
  description: string | null;
  tags: string[];
  subscribers: number | null;
  enabled: boolean;
  createdAt: string;
}

export function ChannelsTab() {
  const { user } = useAuth();
  const isPlatformAdmin = user?.tenantId === null;
  const [data, setData] = useState<ChannelItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [items, t] = await Promise.all([
        api.get<ChannelItem[]>(`/channel-items${tagFilter ? `?tag=${tagFilter}` : ''}`),
        api.get<Array<{ tag: string; count: number }>>('/channel-items/tags'),
      ]);
      setData(items.data);
      setTags(t.data);
    } catch (err) {
      message.error(extractErrorMessage(err, '加载失败'));
    } finally {
      setLoading(false);
    }
  }, [tagFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: ColumnsType<ChannelItem> = useMemo(
    () => [
      { title: 'ID', dataIndex: 'id', width: 60 },
      {
        title: '频道名',
        dataIndex: 'name',
        render: (v: string, row) => (
          <Space>
            <Text>{v}</Text>
            {row.global && <Tag color="gold">🌏 官方种子</Tag>}
            {!row.inviteCode && <Tag color="orange">⚠ 无 invite</Tag>}
          </Space>
        ),
      },
      {
        title: 'Invite Code',
        dataIndex: 'inviteCode',
        render: (v: string | null) =>
          v ? <code style={{ fontSize: 11 }}>{v.slice(0, 8)}...{v.slice(-4)}</code> : <Text type="secondary">—</Text>,
      },
      {
        title: 'Tags',
        dataIndex: 'tags',
        render: (v: string[]) => (
          <Space size={4} wrap>
            {v.map((t) => <Tag key={t} color="blue">{t}</Tag>)}
          </Space>
        ),
      },
      {
        title: '订阅数',
        dataIndex: 'subscribers',
        width: 80,
        render: (v: number | null) => (v != null ? v.toLocaleString() : '—'),
      },
      {
        title: '操作',
        width: 100,
        render: (_: unknown, row) => {
          const canEdit = !row.global || isPlatformAdmin;
          if (!canEdit) return <Text type="secondary" style={{ fontSize: 11 }}>—</Text>;
          return (
            <Popconfirm
              title={`删除「${row.name}」?`}
              onConfirm={async () => {
                try {
                  await api.delete(`/channel-items/${row.id}`);
                  message.success('已删除');
                  await load();
                } catch (err) {
                  message.error(extractErrorMessage(err, '删除失败'));
                }
              }}
            >
              <Button size="small" danger type="link">删除</Button>
            </Popconfirm>
          );
        },
      },
    ],
    [isPlatformAdmin, load],
  );

  return (
    <Card
      size="small"
      title={
        <Space>
          <Text strong>频道素材库</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            共 {data.length} 条 · {tags.length} 个 tag
          </Text>
        </Space>
      }
      extra={
        <Space>
          <Select
            placeholder="按 Tag 过滤"
            allowClear
            value={tagFilter}
            onChange={setTagFilter}
            style={{ width: 180 }}
            options={tags.map((t) => ({ value: t.tag, label: `${t.tag} (${t.count})` }))}
          />
          <Button size="small" onClick={() => void load()} loading={loading}>刷新</Button>
          <Button size="small" onClick={() => setBulkOpen(true)}>📥 CSV 批量导入</Button>
          <Button size="small" type="primary" onClick={() => setAddOpen(true)}>+ 新增频道</Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12, fontSize: 12 }}
        message="🌏 官方种子 (global) 所有租户共享 · 只有平台超管能改. 你自己的频道归本租户."
        description={
          <span>
            收集真 invite code: 搜索引擎 <code>site:whatsapp.com/channel + 行业词</code> · 加入行业 WA 群抓链接 · 客户推荐.
            CSV 模板: <code>scripts/channel-seeds/template.csv</code>
          </span>
        }
      />
      <Table
        rowKey="id"
        dataSource={data}
        columns={columns}
        loading={loading}
        pagination={{ pageSize: 20 }}
        size="small"
      />
      <AddChannelModal
        open={addOpen}
        isPlatformAdmin={isPlatformAdmin}
        onClose={() => setAddOpen(false)}
        onDone={() => {
          setAddOpen(false);
          void load();
        }}
      />
      <BulkImportModal
        open={bulkOpen}
        isPlatformAdmin={isPlatformAdmin}
        onClose={() => setBulkOpen(false)}
        onDone={() => {
          setBulkOpen(false);
          void load();
        }}
      />
    </Card>
  );
}

function AddChannelModal({
  open,
  isPlatformAdmin,
  onClose,
  onDone,
}: {
  open: boolean;
  isPlatformAdmin: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const qs = values.asGlobal && isPlatformAdmin ? '?global=true' : '';
      await api.post(`/channel-items${qs}`, {
        name: values.name,
        inviteCode: values.inviteCode,
        description: values.description,
        tags: (values.tags ?? '').split(',').map((t: string) => t.trim()).filter(Boolean),
      });
      message.success('已添加');
      form.resetFields();
      onDone();
    } catch (err: unknown) {
      if ((err as { errorFields?: unknown }).errorFields) return;
      message.error(extractErrorMessage(err, '添加失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      onOk={handleSubmit}
      confirmLoading={submitting}
      title="+ 添加频道"
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item label="频道名" name="name" rules={[{ required: true }]}>
          <Input placeholder="例: Forex Signals Daily" />
        </Form.Item>
        <Form.Item
          label="Invite Code"
          name="inviteCode"
          rules={[{ required: true, message: '必填 · 否则无法 follow' }]}
          extra="whatsapp.com/channel/XXX 的最后一段"
        >
          <Input placeholder="例: 0029VaXXXXXXXXX" />
        </Form.Item>
        <Form.Item label="Tags (逗号分隔)" name="tags" extra="例: forex, finance-edu">
          <Input placeholder="forex, finance" />
        </Form.Item>
        <Form.Item label="描述 (选填)" name="description">
          <TextArea rows={2} />
        </Form.Item>
        {isPlatformAdmin && (
          <Form.Item name="asGlobal" valuePropName="checked">
            <input type="checkbox" style={{ marginRight: 8 }} /> 作为官方种子 (所有租户可见)
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

function BulkImportModal({
  open,
  isPlatformAdmin,
  onClose,
  onDone,
}: {
  open: boolean;
  isPlatformAdmin: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const qs = values.asGlobal && isPlatformAdmin ? '?global=true' : '';
      const res = await api.post<{ imported: number; skipped: number; errors: string[] }>(
        `/channel-items/bulk-import${qs}`,
        { csv: values.csv, defaultTag: values.defaultTag },
      );
      setResult(res.data);
      form.resetFields();
    } catch (err: unknown) {
      if ((err as { errorFields?: unknown }).errorFields) return;
      message.error(extractErrorMessage(err, '导入失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setResult(null);
    form.resetFields();
    onClose();
    if (result) onDone();
  };

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      title="📥 CSV 批量导入频道"
      width={720}
      footer={
        result ? (
          <Button type="primary" onClick={handleClose}>完成</Button>
        ) : (
          <Space>
            <Button onClick={handleClose}>取消</Button>
            <Button type="primary" onClick={handleSubmit} loading={submitting}>开始导入</Button>
          </Space>
        )
      }
      destroyOnClose
    >
      {result ? (
        <Alert
          type={result.errors.length > 0 ? 'warning' : 'success'}
          showIcon
          message={`导入完成: ${result.imported} 条成功 · ${result.skipped} 条跳过`}
          description={
            result.errors.length > 0 ? (
              <ul style={{ paddingLeft: 16, marginBottom: 0, fontSize: 12 }}>
                {result.errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
                {result.errors.length > 10 && <li>... +{result.errors.length - 10} 条错误</li>}
              </ul>
            ) : null
          }
        />
      ) : (
        <Form form={form} layout="vertical">
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12, fontSize: 12 }}
            message="CSV 格式"
            description={
              <Paragraph style={{ margin: 0, fontSize: 12 }}>
                表头固定: <code>name,invite_code,tags,description</code><br />
                tags 用 | 分隔 · 例: <code>forex|finance-edu</code><br />
                完整模板: <code>scripts/channel-seeds/template.csv</code>
              </Paragraph>
            }
          />
          <Form.Item
            label="CSV 内容"
            name="csv"
            rules={[{ required: true }]}
          >
            <TextArea
              rows={12}
              placeholder={`name,invite_code,tags,description
Forex Daily,0029VaXXX,forex,每日外汇
Crypto News,0029VaYYY,crypto,加密货币`}
            />
          </Form.Item>
          <Form.Item label="默认 Tag (选填 · 每条加上这个 tag)" name="defaultTag">
            <Input placeholder="例: forex" />
          </Form.Item>
          {isPlatformAdmin && (
            <Form.Item name="asGlobal" valuePropName="checked">
              <input type="checkbox" style={{ marginRight: 8 }} /> 作为官方种子 (所有租户可见)
            </Form.Item>
          )}
        </Form>
      )}
    </Modal>
  );
}
