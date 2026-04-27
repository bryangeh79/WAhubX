// 2026-04-28 · 人工接管中心 · 多号 dropdown 单窗口模式
// 设计 (用户执行令):
//   1. 顶部 dropdown 列出所有已绑定号 (客服号优先 · 在线优先)
//   2. 任意时间只允许打开 1 个接管窗口 (前端 state 单 activeSlotId)
//   3. 切号自动 release 旧 + acquire 新 (后端 takeover-lock 已支持 per-account 锁)
//   4. 离开页面时自动释放当前锁 (避免锁泄漏 · backend 30min idle 兜底)
//   5. 每 60s 心跳一次 keep-alive 锁
//
// 历史: 老版只硬看 customer_service 角色号, 用户要任意切号
import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Select, Space, Tag, Typography } from 'antd';
import { MessageOutlined, SwapOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { TakeoverEmbeddedWindow } from './takeover/TakeoverEmbeddedWindow';
import { CustomerArchivePanel } from './takeover/CustomerArchivePanel';

const { Title, Text, Paragraph } = Typography;

const BRAND = '#25d366';
const BRAND_SOFT = '#f0faf4';

interface SlotOption {
  id: number;
  slotIndex: number;
  phoneNumber: string | null;
  status: string;
  role: string;
  online: boolean;
  runtime?: 'baileys' | 'chromium';
  socketLastHeartbeatAt?: string | null;
  accountId: number | null;
}

export function TakeoverPage() {
  const { message, modal } = App.useApp();
  const [slots, setSlots] = useState<SlotOption[]>([]);
  const [activeSlotId, setActiveSlotId] = useState<number | null>(null);
  const [switching, setSwitching] = useState(false);
  const [loading, setLoading] = useState(true);

  // ref 给 unmount cleanup 用 (避免 stale closure)
  const activeSlotIdRef = useRef<number | null>(null);
  const slotsRef = useRef<SlotOption[]>([]);
  useEffect(() => {
    activeSlotIdRef.current = activeSlotId;
  }, [activeSlotId]);
  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);

  const reload = async () => {
    setLoading(true);
    try {
      const res = await api.get<SlotOption[]>('/slots');
      // 已绑定 (有 accountId) 且非空槽位的号
      const eligible = res.data
        .filter((s) => s.accountId !== null && s.status !== 'empty')
        .sort((a, b) => {
          // 客服号优先
          if (a.role === 'customer_service' && b.role !== 'customer_service') return -1;
          if (b.role === 'customer_service' && a.role !== 'customer_service') return 1;
          // 在线优先
          if (a.online && !b.online) return -1;
          if (b.online && !a.online) return 1;
          // 按 slotIndex
          return a.slotIndex - b.slotIndex;
        });
      setSlots(eligible);
    } catch (err) {
      console.warn('load slots failed', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 30_000);
    return () => clearInterval(t);
  }, []);

  // 卸载时自动释放当前锁
  useEffect(() => {
    return () => {
      const slotId = activeSlotIdRef.current;
      if (!slotId) return;
      const slot = slotsRef.current.find((s) => s.id === slotId);
      if (slot?.accountId) {
        // fire-and-forget · 失败也不影响 (backend 30min idle 兜底)
        void api.post(`/takeover/${slot.accountId}/release`).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 锁 keep-alive · 每 60s 一次心跳 (backend 30min idle timer)
  useEffect(() => {
    if (!activeSlotId) return;
    const slot = slots.find((s) => s.id === activeSlotId);
    if (!slot?.accountId) return;
    const accountId = slot.accountId;
    const t = setInterval(() => {
      void api.post(`/takeover/${accountId}/heartbeat`).catch(() => {});
    }, 60_000);
    return () => clearInterval(t);
  }, [activeSlotId, slots]);

  const activeSlot = activeSlotId ? slots.find((s) => s.id === activeSlotId) ?? null : null;

  const handleSwitch = async (newSlotId: number | null) => {
    if (newSlotId === activeSlotId) return;

    setSwitching(true);
    try {
      // 1. 释放旧锁
      if (activeSlotId) {
        const oldSlot = slots.find((s) => s.id === activeSlotId);
        if (oldSlot?.accountId) {
          try {
            await api.post(`/takeover/${oldSlot.accountId}/release`);
          } catch (err) {
            // 释放失败不阻塞 (可能已过期 / hard-killed)
            console.warn('release old failed', err);
          }
        }
      }

      // 2. 抢新锁
      if (newSlotId) {
        const newSlot = slots.find((s) => s.id === newSlotId);
        if (!newSlot?.accountId) {
          message.error('该号没绑定账号');
          setActiveSlotId(null);
          return;
        }
        if (!newSlot.online) {
          message.warning('该号离线 · 仍可打开窗口但无实时画面');
        }
        await api.post(`/takeover/${newSlot.accountId}/acquire`, {});
        message.success(`已接管 #${newSlot.slotIndex} · ${newSlot.phoneNumber ?? '—'}`);
      }

      setActiveSlotId(newSlotId);
    } catch (err: unknown) {
      const errMsg =
        (err as { response?: { data?: { message?: string } }; message?: string })?.response?.data
          ?.message ??
        (err as { message?: string })?.message ??
        '切换失败';
      message.error(errMsg);
    } finally {
      setSwitching(false);
    }
  };

  const handleRelease = () => {
    if (!activeSlotId) return;
    modal.confirm({
      title: '释放接管',
      content: '关闭当前窗口, 该号自动化恢复运行',
      okText: '释放',
      cancelText: '取消',
      onOk: () => handleSwitch(null),
    });
  };

  const heartbeatAgo = (() => {
    if (!activeSlot?.socketLastHeartbeatAt) return null;
    const ms = Date.now() - new Date(activeSlot.socketLastHeartbeatAt).getTime();
    if (ms < 60_000) return `${Math.round(ms / 1000)} 秒前`;
    if (ms < 3600_000) return `${Math.round(ms / 60_000)} 分钟前`;
    return `${Math.round(ms / 3600_000)} 小时前`;
  })();

  const canTakeover = !!activeSlot && activeSlot.online;

  return (
    <div>
      {/* 页眉 */}
      <div style={{ marginBottom: 20 }}>
        <Title level={3} style={{ margin: 0 }}>
          <MessageOutlined style={{ color: BRAND, marginRight: 8 }} />
          人工接管中心
        </Title>
        <Text type="secondary">任选一个号开窗口 · 同一时间只能接管 1 个 · 接管期间该号自动化暂停</Text>
      </div>

      {/* ── 块 A · 选号区 ──────────────── */}
      <Card
        size="small"
        style={{
          marginBottom: 16,
          background: canTakeover ? BRAND_SOFT : '#fafafa',
          border: canTakeover ? `1px solid ${BRAND}` : '1px solid #e0e0e0',
          borderRadius: 10,
        }}
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Space size={10} wrap>
            <Text strong>选择号:</Text>
            <Select
              loading={loading}
              value={activeSlotId}
              onChange={(v) => void handleSwitch(v)}
              disabled={switching}
              style={{ minWidth: 360 }}
              placeholder={slots.length === 0 ? '暂无已绑定号' : '选一个号开窗口'}
              allowClear
              onClear={() => void handleSwitch(null)}
              optionLabelProp="label"
              options={slots.map((s) => ({
                value: s.id,
                label: (
                  <Space size={6}>
                    <Text>#{s.slotIndex}</Text>
                    <Text strong>{s.phoneNumber ?? '拉取中...'}</Text>
                    {s.role === 'customer_service' && (
                      <Tag color="green" style={{ marginRight: 0 }}>
                        客服号
                      </Tag>
                    )}
                    {s.online ? (
                      <Tag color="green" style={{ marginRight: 0 }}>
                        ● 在线
                      </Tag>
                    ) : (
                      <Tag color="orange" style={{ marginRight: 0 }}>
                        ● 离线
                      </Tag>
                    )}
                  </Space>
                ),
              }))}
            />
            {activeSlotId && (
              <Button icon={<SwapOutlined />} onClick={handleRelease} loading={switching}>
                释放
              </Button>
            )}
          </Space>
          {heartbeatAgo && activeSlot && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              当前: #{activeSlot.slotIndex} · {activeSlot.phoneNumber ?? '—'} · 最近心跳 {heartbeatAgo}
            </Text>
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>
            ⚠ 同一时间只能接管 1 个号 · 切换号会自动释放当前窗口 · 离开本页面也会自动释放
          </Text>
        </Space>
      </Card>

      {/* ── 块 B · 状态提示 ──────────────── */}
      {activeSlot && !activeSlot.online && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="该号当前离线"
          description='请到 "账号槽位" 重扫码 · 或等 chromium runtime rehydrate'
        />
      )}

      {/* ── 块 C · 接管窗口落点容器 (CDP screencast 嵌入) ──────────────── */}
      <Card
        size="small"
        style={{
          borderRadius: 10,
          background: '#000',
          padding: 0,
          marginBottom: 16,
        }}
        styles={{ body: { padding: 4 } }}
      >
        {canTakeover && activeSlot ? (
          // key={slotId} 确保切号时 remount · 避免旧 socket 复用
          <TakeoverEmbeddedWindow key={activeSlot.id} slotId={activeSlot.id} enableInput={true} />
        ) : (
          <div
            style={{
              minHeight: 360,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              color: '#fff',
              padding: 40,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 56, color: '#bfbfbf', marginBottom: 16 }}>🪟</div>
            <Title level={5} style={{ margin: 0, marginBottom: 8, color: '#fff' }}>
              系统内接管窗口区域
            </Title>
            <Paragraph style={{ fontSize: 12, color: '#bbb', margin: 0, marginBottom: 4 }}>
              {!activeSlotId
                ? slots.length === 0
                  ? '暂无已绑定号 · 请先去 "账号槽位" 扫码绑定'
                  : '从上方下拉选一个号开始接管'
                : !activeSlot
                  ? '该号已下线 · 请重选'
                  : !activeSlot.online
                    ? '该号离线 · 等 rehydrate 或重扫'
                    : '准备中...'}
            </Paragraph>
          </div>
        )}
      </Card>

      {/* ── 块 D · 客户档案 · 只读 · 历史消息存档 ──────────────── */}
      {activeSlot?.accountId ? (
        <Card size="small" style={{ borderRadius: 10 }}>
          <CustomerArchivePanel
            slotId={activeSlot.id}
            accountId={activeSlot.accountId}
            slotLabel={`#${activeSlot.slotIndex} · ${activeSlot.phoneNumber ?? '—'}`}
          />
        </Card>
      ) : (
        <Card size="small" style={{ borderRadius: 10 }}>
          <Alert
            type="info"
            showIcon
            message="客户档案 · 选号后显示"
            description="选一个号开始接管, 这里显客户名单 + 历史消息存档 (只读)"
          />
        </Card>
      )}
    </div>
  );
}
