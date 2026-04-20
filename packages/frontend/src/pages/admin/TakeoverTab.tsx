// M9 · 接管 UI (§4.8)
// 布局: 左列 bound slots 列表 · 右侧上半 lock 控制条 + 联系人抽屉, 右侧下半消息流 + 发送区.
// 状态: acquire 后进入 "in-takeover", 失联 / 闲置 / release 各自状态切换.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Divider,
  Empty,
  Input,
  List,
  Popconfirm,
  Row,
  Select,
  Space,
  Tag,
  Tooltip,
  Upload,
  message as antdMessage,
} from 'antd';
import type { UploadFile } from 'antd';
import { io, Socket } from 'socket.io-client';
import { api, extractErrorMessage, getAccessToken } from '@/lib/api';

// ── 类型 ────────────────────────────────────────────────
interface Slot {
  id: number;
  slotIndex: number;
  accountId: number | null;
  status: string;
  tenantId: number;
  takeoverActive: boolean;
  wa?: { phoneNumber: string | null; waNickname: string | null } | null;
}

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
  scriptRunId: number | null;
}

interface LockStateView {
  accountId: number;
  slotId: number;
  userId: string;
  userEmail: string;
  acquiredAt: string;
  lastActivityAt: string;
  socketCount: number;
  idleMs: number;
}

interface TakeoverMessageEvent extends Omit<ChatMsg, 'createdAt'> {
  accountId: number;
  remoteJid: string;
  waMessageId: string | null;
  manual: boolean;
}

// 30s hard-kill reveal threshold (Z1+ 决策)
const HARD_KILL_REVEAL_MS = 30_000;
// socket heartbeat 10s (backend idle timer 在 28min/30min, 心跳拉动 idle)
const SOCKET_HEARTBEAT_MS = 10_000;

export function TakeoverTab() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<Slot[]>('/slots');
      setSlots(res.data.filter((s) => s.accountId !== null));
    } catch (err) {
      setError(extractErrorMessage(err, '加载槽位失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedSlot = useMemo(
    () => slots.find((s) => s.accountId === selectedAccountId) ?? null,
    [slots, selectedAccountId],
  );

  return (
    <Card
      size="small"
      extra={
        <Button size="small" onClick={() => void load()} loading={loading}>
          刷新
        </Button>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="接管模式 · §B.8"
        description="进入接管后自动暂停该号所有养号/剧本任务. 30 分钟闲置自动释放锁. 28 分钟出现预警 toast. 若 30 秒内未完成 graceful pause, 可用 🚨 强制接管 逃生口."
      />
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 12 }} />}
      <Row gutter={12}>
        <Col span={6}>
          <List
            size="small"
            header={<b>已绑定账号 ({slots.length})</b>}
            bordered
            dataSource={slots}
            locale={{ emptyText: <Empty description="还没有绑定账号" /> }}
            renderItem={(s) => (
              <List.Item
                style={{ cursor: 'pointer', background: selectedAccountId === s.accountId ? '#e6f7ff' : undefined }}
                onClick={() => setSelectedAccountId(s.accountId)}
              >
                <Space direction="vertical" size={0} style={{ width: '100%' }}>
                  <Space>
                    <Tag color={s.takeoverActive ? 'red' : s.status === 'active' ? 'green' : 'blue'}>
                      #{String(s.slotIndex).padStart(2, '0')}
                    </Tag>
                    {s.takeoverActive && <Tag color="red">接管中</Tag>}
                  </Space>
                  <span style={{ fontSize: 12 }}>
                    {s.wa?.phoneNumber ?? '—'}
                  </span>
                  <span style={{ fontSize: 11, color: '#888' }}>
                    {s.wa?.waNickname ?? ''}
                  </span>
                </Space>
              </List.Item>
            )}
          />
        </Col>
        <Col span={18}>
          {selectedSlot ? (
            <TakeoverPane slot={selectedSlot} onSlotChanged={() => void load()} />
          ) : (
            <Empty description="请从左侧选择一个账号开始接管" />
          )}
        </Col>
      </Row>
    </Card>
  );
}

// ── 右侧接管面板 ────────────────────────────────────────
function TakeoverPane({ slot, onSlotChanged }: { slot: Slot; onSlotChanged: () => void }) {
  const accountId = slot.accountId!;
  const [lock, setLock] = useState<LockStateView | null>(null);
  const [acquiredByMe, setAcquiredByMe] = useState(false);
  const [acquireInFlight, setAcquireInFlight] = useState<Date | null>(null); // 启 hard-kill reveal 计时
  const [showHardKill, setShowHardKill] = useState(false);
  const [idleWarned, setIdleWarned] = useState(false);

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadFile, setUploadFile] = useState<UploadFile | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'voice' | 'file'>('image');

  const socketRef = useRef<Socket | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const hardKillTimerRef = useRef<number | null>(null);

  // 初次 mount · 查 lock 状态 + 查联系人
  const reloadLock = useCallback(async () => {
    try {
      const res = await api.get<{ lock: LockStateView | null }>(`/takeover/${accountId}/status`);
      setLock(res.data.lock);
      const myEmail = parseJwtEmail(getAccessToken());
      setAcquiredByMe(!!res.data.lock && res.data.lock.userEmail === myEmail);
    } catch {
      setLock(null);
      setAcquiredByMe(false);
    }
  }, [accountId]);

  const reloadContacts = useCallback(async () => {
    try {
      const res = await api.get<{ contacts: Contact[] }>(`/chats/${accountId}/conversations`);
      setContacts(res.data.contacts);
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '加载联系人失败'));
    }
  }, [accountId]);

  const reloadMessages = useCallback(
    async (contactId: number | null) => {
      if (!contactId) {
        setMessages([]);
        return;
      }
      try {
        const res = await api.get<{ messages: ChatMsg[] }>(`/chats/${accountId}/messages`, {
          params: { contactId, limit: 50 },
        });
        // 后端 DESC, UI ASC
        setMessages(res.data.messages.slice().reverse());
      } catch (err) {
        antdMessage.error(extractErrorMessage(err, '加载消息失败'));
      }
    },
    [accountId],
  );

  useEffect(() => {
    void reloadLock();
    void reloadContacts();
  }, [reloadLock, reloadContacts]);

  useEffect(() => {
    void reloadMessages(selectedContactId);
  }, [selectedContactId, reloadMessages]);

  // ── Lock 生命周期 ─────────────────────────────────────
  const handleAcquire = async () => {
    setAcquireInFlight(new Date());
    try {
      const res = await api.post<LockStateView>(`/takeover/${accountId}/acquire`, {});
      setLock(res.data);
      setAcquiredByMe(true);
      antdMessage.success(`已获取接管锁 · 账号 ${accountId}`);
      connectSocket();
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '获取锁失败'));
      setAcquireInFlight(null);
    }
    onSlotChanged();
  };

  const handleRelease = async () => {
    try {
      await api.post(`/takeover/${accountId}/release`);
      antdMessage.success('已释放接管锁');
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '释放失败'));
    }
    setLock(null);
    setAcquiredByMe(false);
    setShowHardKill(false);
    setAcquireInFlight(null);
    disconnectSocket();
    onSlotChanged();
  };

  const handleHardKill = async () => {
    try {
      const res = await api.post<{ interruptedRunIds: number[] }>(
        `/takeover/${accountId}/hard-kill`,
      );
      antdMessage.warning(
        `已强制中断 ${res.data.interruptedRunIds.length} 个任务 · task_run=interrupted (不扣分)`,
      );
      setShowHardKill(false);
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, 'Hard-kill 失败'));
    }
  };

  // ── 30s hard-kill reveal ──────────────────────────────
  useEffect(() => {
    if (!acquireInFlight || !acquiredByMe) {
      if (hardKillTimerRef.current) {
        window.clearTimeout(hardKillTimerRef.current);
        hardKillTimerRef.current = null;
      }
      return;
    }
    if (hardKillTimerRef.current) window.clearTimeout(hardKillTimerRef.current);
    hardKillTimerRef.current = window.setTimeout(() => {
      setShowHardKill(true);
    }, HARD_KILL_REVEAL_MS);
    return () => {
      if (hardKillTimerRef.current) window.clearTimeout(hardKillTimerRef.current);
    };
  }, [acquireInFlight, acquiredByMe]);

  // ── socket.io 连接 ────────────────────────────────────
  const connectSocket = useCallback(() => {
    if (socketRef.current?.connected) return;
    const token = getAccessToken();
    if (!token) {
      antdMessage.error('未登录, 无法连接 socket');
      return;
    }
    const sock = io('/takeover', {
      transports: ['websocket', 'polling'],
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    sock.on('connect', () => {
      sock.emit('subscribe', { accountId }, (_ack: unknown) => {
        // ack ignored
      });
    });
    sock.on('connect_error', (err) => {
      // auth 失败: 后端 disconnect(true) 前端 connect_error · 不自动重连
      antdMessage.warning(`socket 连接失败: ${err.message}`);
    });

    sock.on('message.in', (ev: TakeoverMessageEvent) => {
      if (ev.contactId === selectedContactId) {
        void reloadMessages(selectedContactId);
      }
      // 联系人列表 last_message_at 变动 · 刷
      void reloadContacts();
    });
    sock.on('message.out', (ev: TakeoverMessageEvent) => {
      if (ev.contactId === selectedContactId || ev.contactId === 0) {
        void reloadMessages(selectedContactId);
      }
    });
    sock.on('lock.idle_warning', () => {
      setIdleWarned(true);
      antdMessage.warning('接管已闲置 28 分钟, 还剩 2 分钟自动释放锁', 6);
    });
    sock.on('lock.idle_timeout', () => {
      antdMessage.info('接管锁已超时自动释放');
      setLock(null);
      setAcquiredByMe(false);
      setShowHardKill(false);
      disconnectSocket();
    });
    sock.on('lock.released', () => {
      setLock(null);
      setAcquiredByMe(false);
      setShowHardKill(false);
      disconnectSocket();
    });
    sock.on('lock.hard_kill', (ev: { interruptedRunIds: number[] }) => {
      antdMessage.warning(`强制中断生效 · ${ev.interruptedRunIds.length} 个 task_run=interrupted`);
    });

    socketRef.current = sock;

    // Heartbeat (10s)
    if (heartbeatTimerRef.current) window.clearInterval(heartbeatTimerRef.current);
    heartbeatTimerRef.current = window.setInterval(() => {
      if (sock.connected) sock.emit('heartbeat', { accountId });
    }, SOCKET_HEARTBEAT_MS);
  }, [accountId, selectedContactId, reloadContacts, reloadMessages]);

  const disconnectSocket = useCallback(() => {
    if (heartbeatTimerRef.current) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.emit('unsubscribe', { accountId });
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, [accountId]);

  // 切号时断旧 socket
  useEffect(() => {
    return () => disconnectSocket();
  }, [disconnectSocket]);

  // ── 发消息 ────────────────────────────────────────────
  const handleSendText = async () => {
    if (!draft.trim() || !selectedContactId) return;
    const to = contacts.find((c) => c.id === selectedContactId)?.remoteJid;
    if (!to) return;
    setSending(true);
    try {
      await api.post(`/chats/${accountId}/send-text`, { to, text: draft });
      setDraft('');
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '发送失败'));
    } finally {
      setSending(false);
    }
  };

  const handleSendMedia = async () => {
    if (!uploadFile?.originFileObj || !selectedContactId) return;
    const to = contacts.find((c) => c.id === selectedContactId)?.remoteJid;
    if (!to) return;
    setSending(true);
    try {
      const fd = new FormData();
      fd.append('file', uploadFile.originFileObj);
      fd.append('to', to);
      fd.append('type', mediaType);
      if (draft) fd.append('caption', draft);
      await api.post(`/chats/${accountId}/send-media`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120_000,
      });
      setUploadFile(null);
      setDraft('');
      antdMessage.success('媒体发送成功');
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '媒体发送失败'));
    } finally {
      setSending(false);
    }
  };

  // ── 渲染 ──────────────────────────────────────────────
  const lockBanner = lock ? (
    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
      <Space size="small">
        <Badge status={acquiredByMe ? 'success' : 'error'} />
        <b>{acquiredByMe ? '我正在接管' : `锁被 ${lock.userEmail} 持有`}</b>
        {idleWarned && <Tag color="warning">闲置预警</Tag>}
      </Space>
      <Space>
        {showHardKill && acquiredByMe && (
          <Popconfirm
            title="强制接管 · 中断正在运行的 task_run"
            description="task_run.status → interrupted (不扣分). 用于 30s 内 graceful pause 未生效的救场场景."
            okText="强制中断"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => void handleHardKill()}
          >
            <Button danger size="small">
              🚨 强制接管
            </Button>
          </Popconfirm>
        )}
        {acquiredByMe && (
          <Button size="small" onClick={() => void handleRelease()}>
            释放锁
          </Button>
        )}
      </Space>
    </Space>
  ) : (
    <Space>
      <Badge status="default" />
      <span>当前无接管 · 任务正常调度</span>
      <Button size="small" type="primary" onClick={() => void handleAcquire()}>
        获取接管锁
      </Button>
    </Space>
  );

  return (
    <Card size="small" title={`#${String(slot.slotIndex).padStart(2, '0')} · ${slot.wa?.phoneNumber ?? '—'}`}>
      <div style={{ marginBottom: 12 }}>{lockBanner}</div>
      <Divider style={{ margin: '8px 0' }} />
      <Row gutter={12}>
        <Col span={8}>
          <List
            size="small"
            header={<b>联系人 ({contacts.length})</b>}
            bordered
            dataSource={contacts}
            locale={{ emptyText: <Empty description="暂无消息" /> }}
            style={{ maxHeight: 480, overflow: 'auto' }}
            renderItem={(c) => (
              <List.Item
                style={{
                  cursor: 'pointer',
                  background: selectedContactId === c.id ? '#e6f7ff' : undefined,
                }}
                onClick={() => setSelectedContactId(c.id)}
              >
                <Space direction="vertical" size={0} style={{ width: '100%' }}>
                  <span>{c.displayName ?? c.remoteJid.split('@')[0]}</span>
                  <span style={{ fontSize: 11, color: '#888' }}>
                    {c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleString('zh-CN') : '—'}
                  </span>
                </Space>
              </List.Item>
            )}
          />
        </Col>
        <Col span={16}>
          <Card size="small" bodyStyle={{ padding: 8 }}>
            <div style={{ maxHeight: 360, overflow: 'auto', padding: 8, background: '#fafafa', borderRadius: 4 }}>
              {messages.length === 0 ? (
                <Empty description="选中联系人查看消息" />
              ) : (
                messages.map((m) => <MessageBubble key={m.id} msg={m} />)
              )}
            </div>
            <Divider style={{ margin: '8px 0' }} />
            {acquiredByMe && selectedContactId ? (
              <Space direction="vertical" style={{ width: '100%' }}>
                <Input.TextArea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="输入消息 · Cmd+Enter 发送"
                  rows={2}
                  onPressEnter={(e) => {
                    if ((e.metaKey || e.ctrlKey) && !uploadFile) void handleSendText();
                  }}
                />
                <Space>
                  <Select
                    value={mediaType}
                    onChange={setMediaType}
                    style={{ width: 90 }}
                    size="small"
                    options={[
                      { value: 'image', label: '图片' },
                      { value: 'voice', label: '语音' },
                      { value: 'file', label: '文件' },
                    ]}
                  />
                  <Upload
                    beforeUpload={() => false}
                    maxCount={1}
                    fileList={uploadFile ? [uploadFile] : []}
                    onChange={({ fileList }) => setUploadFile(fileList[0] ?? null)}
                  >
                    <Button size="small">选择文件</Button>
                  </Upload>
                  <Tooltip title="上限 95MB · 自动剥 EXIF">
                    <span style={{ fontSize: 11, color: '#888' }}>卫生检查已开</span>
                  </Tooltip>
                  <Button
                    type="primary"
                    size="small"
                    loading={sending}
                    disabled={!draft && !uploadFile}
                    onClick={() => (uploadFile ? void handleSendMedia() : void handleSendText())}
                  >
                    {uploadFile ? '发送媒体' : '发送文本'}
                  </Button>
                </Space>
              </Space>
            ) : (
              <Alert
                type="info"
                message={acquiredByMe ? '请先选择联系人' : '先获取接管锁再发送消息'}
                showIcon
              />
            )}
          </Card>
        </Col>
      </Row>
    </Card>
  );
}

function MessageBubble({ msg }: { msg: ChatMsg }) {
  const isOut = msg.direction === 'out';
  const manual = msg.scriptRunId === null && isOut;
  return (
    <div style={{ display: 'flex', justifyContent: isOut ? 'flex-end' : 'flex-start', marginBottom: 6 }}>
      <div
        style={{
          maxWidth: '70%',
          padding: '6px 10px',
          borderRadius: 8,
          background: isOut ? '#25d366' : '#fff',
          color: isOut ? '#fff' : '#000',
          border: isOut ? 'none' : '1px solid #e8e8e8',
          fontSize: 13,
        }}
      >
        {msg.msgType !== 'text' && (
          <Tag color={isOut ? undefined : 'default'} style={{ marginRight: 4 }}>
            {msg.msgType}
          </Tag>
        )}
        {msg.content ?? (msg.mediaPath ? <i>[媒体]</i> : <i>[空消息]</i>)}
        <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>
          {new Date(msg.sentAt).toLocaleTimeString('zh-CN')}
          {manual && <span style={{ marginLeft: 4 }}>· 手动</span>}
        </div>
      </div>
    </div>
  );
}

// 粗略解析 JWT · 只读 email 给 UI 判 "锁是不是我拿的". 不用于鉴权.
function parseJwtEmail(token: string | null): string | null {
  if (!token) return null;
  try {
    const body = JSON.parse(atob(token.split('.')[1]));
    return body.email ?? null;
  } catch {
    return null;
  }
}
