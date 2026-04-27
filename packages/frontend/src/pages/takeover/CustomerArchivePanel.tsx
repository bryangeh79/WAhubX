// 2026-04-26 · P0.10c · 客户档案 · 只读
// 设计 (用户执行令):
//   1. 数据 + endpoint 全复用 · DB-backed (chat_message + wa_contact)
//   2. 严格只读: 不放回复输入框 / 不放发送按钮 / 不放 acquire/release
//   3. 文案明确: 客户档案 / 历史消息 / 只读记录
//   4. 上半 (canvas) = 实时操作; 下半 (本组件) = 只读历史档案
//
// API 复用:
//   GET /chats/:accountId/conversations         · contacts
//   GET /chats/:accountId/messages?contactId=N  · messages
//   GET /slots/:id/export/contacts.csv          · CSV 导出
//   GET /slots/:id/export/chats.txt             · TXT 导出
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Input, List, Space, Spin, Tag, Typography } from 'antd';
import { DownloadOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
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
  contactId: number;
  mediaPath: string | null;
}

interface Props {
  /** CS slot id (导出用) */
  slotId: number;
  /** CS account id (查 contacts/messages 用) */
  accountId: number;
  /** CS slot 友好名 */
  slotLabel: string;
}

export function CustomerArchivePanel({ slotId, accountId, slotLabel }: Props) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const reloadContacts = async () => {
    setLoadingContacts(true);
    setError(null);
    try {
      const res = await api.get<{ contacts: Contact[] }>(`/chats/${accountId}/conversations`);
      const list = (res.data.contacts ?? []).slice().sort((a, b) => {
        const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        return bt - at; // 最新交互在上
      });
      setContacts(list);
    } catch (err) {
      setError(extractErrorMessage(err, '加载客户名单失败'));
    } finally {
      setLoadingContacts(false);
    }
  };

  const reloadMessages = async (contactId: number) => {
    setLoadingMessages(true);
    try {
      const res = await api.get<{ messages: ChatMsg[] }>(`/chats/${accountId}/messages`, {
        params: { contactId, limit: 200 },
      });
      const list = (res.data.messages ?? []).slice().sort((a, b) =>
        new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime(),
      );
      setMessages(list);
      // 滚到底
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      });
    } catch (err) {
      setError(extractErrorMessage(err, '加载历史消息失败'));
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    void reloadContacts();
    // 30s 自动刷一次客户名单 (新交互排序变化)
    const t = setInterval(() => void reloadContacts(), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  useEffect(() => {
    if (selectedContactId !== null) void reloadMessages(selectedContactId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContactId]);

  const filteredContacts = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return contacts;
    return contacts.filter((c) =>
      (c.displayName ?? '').toLowerCase().includes(s) ||
      c.remoteJid.toLowerCase().includes(s),
    );
  }, [contacts, search]);

  const selectedContact = useMemo(
    () => contacts.find((c) => c.id === selectedContactId) ?? null,
    [contacts, selectedContactId],
  );

  const phoneFromJid = (jid: string): string => {
    const m = jid.match(/^(\d{8,15})@/);
    return m ? `+${m[1]}` : jid;
  };

  const fmtTime = (iso: string | null): string => {
    if (!iso) return '—';
    const d = new Date(iso);
    const now = Date.now();
    const ms = now - d.getTime();
    if (ms < 60_000) return `${Math.round(ms / 1000)} 秒前`;
    if (ms < 3600_000) return `${Math.round(ms / 60_000)} 分钟前`;
    if (ms < 86400_000) return `${Math.round(ms / 3600_000)} 小时前`;
    return d.toLocaleDateString('zh-CN');
  };

  const handleExportContacts = () => {
    window.open(`/api/v1/slots/${slotId}/export/contacts.csv`, '_blank');
  };
  const handleExportChats = () => {
    window.open(`/api/v1/slots/${slotId}/export/chats.txt`, '_blank');
  };

  return (
    <div>
      {/* 顶部 · 标题 + 导出按钮 + 刷新 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <Space size={10}>
          <Text strong style={{ fontSize: 15 }}>客户档案</Text>
          <Tag color="default" style={{ fontSize: 11 }}>只读 · 历史消息存档</Tag>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {slotLabel}
          </Text>
        </Space>
        <Space size={8}>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={loadingContacts}
            onClick={() => void reloadContacts()}
          >
            刷新
          </Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={handleExportContacts}>
            导出客户名单 (CSV)
          </Button>
          <Button size="small" icon={<DownloadOutlined />} onClick={handleExportChats}>
            导出聊天记录 (TXT)
          </Button>
        </Space>
      </div>

      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 12 }} />}

      {/* 主区 · 左右分栏 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '320px 1fr',
          gap: 12,
          minHeight: 400,
        }}
      >
        {/* 左 · 客户名单 */}
        <div
          style={{
            border: '1px solid #eee',
            borderRadius: 8,
            background: '#fff',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 600,
          }}
        >
          <div style={{ padding: 8, borderBottom: '1px solid #eee' }}>
            <Input
              size="small"
              placeholder="搜索 · 名称 / 号码"
              prefix={<SearchOutlined />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              allowClear
            />
            <div style={{ marginTop: 6, fontSize: 11, color: '#888' }}>
              共 {contacts.length} 位客户
            </div>
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {loadingContacts && contacts.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center' }}>
                <Spin />
              </div>
            ) : filteredContacts.length === 0 ? (
              <Empty description="无客户" style={{ padding: 24 }} />
            ) : (
              <List
                size="small"
                dataSource={filteredContacts}
                renderItem={(c) => (
                  <List.Item
                    style={{
                      cursor: 'pointer',
                      background: selectedContactId === c.id ? '#e6f7ff' : undefined,
                      padding: '8px 12px',
                      borderBottom: '1px solid #f5f5f5',
                    }}
                    onClick={() => setSelectedContactId(c.id)}
                  >
                    <Space direction="vertical" size={0} style={{ width: '100%' }}>
                      <Space size={6}>
                        <Text strong style={{ fontSize: 13 }}>
                          {c.displayName || phoneFromJid(c.remoteJid)}
                        </Text>
                      </Space>
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {c.remoteJid.startsWith('synthetic-')
                          ? <Tag color="orange" style={{ fontSize: 10, margin: 0 }}>synthetic</Tag>
                          : phoneFromJid(c.remoteJid)}
                        {' · '}{fmtTime(c.lastMessageAt)}
                      </Text>
                    </Space>
                  </List.Item>
                )}
              />
            )}
          </div>
        </div>

        {/* 右 · 历史消息 (只读) */}
        <div
          style={{
            border: '1px solid #eee',
            borderRadius: 8,
            background: '#fafafa',
            display: 'flex',
            flexDirection: 'column',
            maxHeight: 600,
          }}
        >
          {!selectedContact ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Empty description="请从左侧选择一位客户查看历史消息" />
            </div>
          ) : (
            <>
              <div style={{ padding: 10, borderBottom: '1px solid #eee', background: '#fff' }}>
                <Text strong style={{ fontSize: 14 }}>
                  {selectedContact.displayName || phoneFromJid(selectedContact.remoteJid)}
                </Text>
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 11 }}>
                  {phoneFromJid(selectedContact.remoteJid)}
                </Text>
                <Tag color="default" style={{ marginLeft: 8, fontSize: 10 }}>历史消息 · 只读</Tag>
              </div>
              <div
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                {loadingMessages && messages.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 24 }}>
                    <Spin />
                  </div>
                ) : messages.length === 0 ? (
                  <Empty description="无历史消息" />
                ) : (
                  messages.map((m) => (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: m.direction === 'out' ? 'flex-end' : 'flex-start',
                      }}
                    >
                      <div
                        style={{
                          maxWidth: '70%',
                          padding: '6px 10px',
                          borderRadius: 8,
                          background: m.direction === 'out' ? '#dcf8c6' : '#fff',
                          border: '1px solid #eee',
                          fontSize: 13,
                          lineHeight: 1.45,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {m.msgType !== 'text' && (
                          <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>
                            [{m.msgType}]
                          </div>
                        )}
                        {m.content || <Text type="secondary">(无内容)</Text>}
                      </div>
                      <Text type="secondary" style={{ fontSize: 10, marginTop: 1 }}>
                        {new Date(m.sentAt).toLocaleString('zh-CN')}
                        {' · '}
                        {m.direction === 'out' ? '发出' : '收到'}
                      </Text>
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
            </>
          )}
        </div>
      </div>

      <Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 11 }}>
        💡 此区域为只读档案 · 不能在此回复 · 实时操作请用上方接管窗口
      </Paragraph>
    </div>
  );
}
