import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
  message as antdMessage,
} from 'antd';
import { api, extractErrorMessage } from '@/lib/api';

const { Text, Paragraph } = Typography;

interface Contact {
  id: number;
  remoteJid: string;
  displayName: string | null;
  lastMessageAt: string | null;
}

interface ChatMsg {
  id: string;
  direction: 'in' | 'out';
  msgType: 'text' | 'image' | 'voice' | 'file' | 'other';
  content: string | null;
  sentAt: string;
  createdAt: string;
  contactId: number;
}

interface Props {
  slotId: number;
  slotIndex: number;
  phoneNumber: string | null;
  open: boolean;
  onClose: () => void;
}

export function ChatModal({ slotId, slotIndex, phoneNumber, open, onClose }: Props) {
  const [online, setOnline] = useState<boolean | null>(null);

  const refreshOnline = useCallback(async () => {
    if (!open) return;
    try {
      const res = await api.get<{ online: boolean }>(`/slots/${slotId}/online-status`);
      setOnline(res.data.online);
    } catch {
      setOnline(false);
    }
  }, [open, slotId]);

  useEffect(() => {
    if (open) void refreshOnline();
  }, [open, refreshOnline]);

  return (
    <Modal
      title={`#${slotIndex} · ${phoneNumber ?? '未知号码'}`}
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      destroyOnClose
    >
      <OnlineBadge online={online} onRefresh={() => void refreshOnline()} />
      <Tabs
        defaultActiveKey="send"
        items={[
          { key: 'send', label: '发消息', children: <SendTab slotId={slotId} /> },
          { key: 'contacts', label: '联系人', children: <ContactsTab slotId={slotId} /> },
          { key: 'messages', label: '最近消息', children: <MessagesTab slotId={slotId} /> },
        ]}
      />
    </Modal>
  );
}

function OnlineBadge({ online, onRefresh }: { online: boolean | null; onRefresh: () => void }) {
  const tag =
    online === null ? (
      <Tag>未知</Tag>
    ) : online ? (
      <Badge status="success" text="socket 在线" />
    ) : (
      <Badge status="error" text="socket 离线 (可能断开重连 / 未 rehydrate)" />
    );
  return (
    <Space style={{ marginBottom: 12 }}>
      {tag}
      <Button size="small" onClick={onRefresh}>刷新状态</Button>
    </Space>
  );
}

// ── Send tab ──────────────────────────────────────────────
function SendTab({ slotId }: { slotId: number }) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const onFinish = async (values: { to: string; text: string }) => {
    setSubmitting(true);
    try {
      const res = await api.post<{ waMessageId: string | null }>(`/slots/${slotId}/send`, values);
      antdMessage.success(`已发送 · WA msg id: ${res.data.waMessageId ?? '—'}`);
      form.resetFields(['text']);
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '发送失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <Paragraph type="secondary" style={{ fontSize: 12 }}>
        收件人支持手机号 (e.g. <code>60123456789</code>) 或完整 JID (e.g. <code>60123456789@s.whatsapp.net</code>).
        群 JID 形如 <code>xxx-xxx@g.us</code>.
      </Paragraph>
      <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
        <Form.Item label="收件人" name="to" rules={[{ required: true, message: '请输入收件人' }]}>
          <Input placeholder="60123456789 或 xxx@s.whatsapp.net" autoComplete="off" />
        </Form.Item>
        <Form.Item
          label="消息内容"
          name="text"
          rules={[
            { required: true, message: '请输入消息内容' },
            { max: 4096, message: '单条文本最长 4096 字符' },
          ]}
        >
          <Input.TextArea rows={4} placeholder="输入要发送的文本..." />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" loading={submitting} block>
            发送
          </Button>
        </Form.Item>
      </Form>
    </div>
  );
}

// ── Contacts tab ──────────────────────────────────────────
function ContactsTab({ slotId }: { slotId: number }) {
  const [data, setData] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<Contact[]>(`/slots/${slotId}/contacts`);
      setData(res.data);
    } catch (err) {
      setError(extractErrorMessage(err, '加载联系人失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [slotId]);

  if (loading) return <Spin />;
  if (error) return <Alert type="error" message={error} showIcon />;
  if (data.length === 0) return <Empty description="暂无联系人 (等对方发第一条消息自动出现)" />;

  return (
    <List
      size="small"
      dataSource={data}
      renderItem={(c) => (
        <List.Item>
          <List.Item.Meta
            title={<Text>{c.displayName ?? jidToPhone(c.remoteJid)}</Text>}
            description={<Text type="secondary" style={{ fontSize: 12 }}>{c.remoteJid}</Text>}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleString('zh-CN') : '—'}
          </Text>
        </List.Item>
      )}
    />
  );
}

function jidToPhone(jid: string): string {
  const prefix = jid.split('@')[0];
  return prefix || jid;
}

// ── Messages tab ──────────────────────────────────────────
function MessagesTab({ slotId }: { slotId: number }) {
  const [data, setData] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ChatMsg[]>(`/slots/${slotId}/messages?limit=50`);
      setData(res.data);
    } catch (err) {
      setError(extractErrorMessage(err, '加载消息失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [slotId]);

  if (loading) return <Spin />;
  if (error) return <Alert type="error" message={error} showIcon />;
  if (data.length === 0) return <Empty description="暂无消息" />;

  return (
    <List
      size="small"
      dataSource={data}
      renderItem={(m) => (
        <List.Item>
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Space>
              <Tag color={m.direction === 'out' ? 'blue' : 'green'}>
                {m.direction === 'out' ? '↑ 发出' : '↓ 收到'}
              </Tag>
              <Tag>{m.msgType}</Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {new Date(m.sentAt).toLocaleString('zh-CN')}
              </Text>
            </Space>
            <Text style={{ whiteSpace: 'pre-wrap' }}>
              {m.content ?? <Text type="secondary">(非文本消息, 无预览)</Text>}
            </Text>
          </Space>
        </List.Item>
      )}
    />
  );
}
