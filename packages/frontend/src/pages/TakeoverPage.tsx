// 2026-04-28 · 人工接管中心 · 多号 dropdown 单窗口模式
// 设计 (用户执行令):
//   1. 顶部 dropdown 列出所有已绑定号 (客服号优先 · 在线优先)
//   2. 任意时间只允许打开 1 个接管窗口 (前端 state 单 activeSlotId)
//   3. 切号自动 release 旧 + acquire 新 (后端 takeover-lock 已支持 per-account 锁)
//   4. 跨页面导航不释放 · sessionStorage 持久化 activeSlotId
//      释放时机仅: 显式切号 / 显式点 [释放] / backend 30min idle 兜底
//   5. 每 60s 心跳一次 keep-alive 锁 (仅页面打开时)
import { useCallback, useEffect, useRef, useState } from 'react';
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

// 2026-04-28 · 接管态持久化 · 跨页面导航不释放锁
// 用户体验: 选了 slot 2 后切去广告页 / 仪表盘 · 回来仍是 slot 2 接管中
// 释放时机: 显式切号 · 显式点 [释放] · backend 30min idle 兜底 · 关 tab/窗口
//
// 用 sessionStorage 不是 localStorage · 只在当前浏览器 tab 有效
// 关闭 tab/窗口 = 自动清 (避免跨日跨会话误激活 · 老 bug 用户被静默接管 slot)

function loadActiveSlotIdFromStorage(): number | null {
  try {
    const raw = sessionStorage.getItem(TAKEOVER_STORAGE_KEY);
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function saveActiveSlotIdToStorage(slotId: number | null): void {
  try {
    if (slotId === null) sessionStorage.removeItem(TAKEOVER_STORAGE_KEY);
    else sessionStorage.setItem(TAKEOVER_STORAGE_KEY, String(slotId));
  } catch {
    /* sessionStorage 满了不致命 */
  }
}

export function TakeoverPage() {
  const { message, modal } = App.useApp();
  const [slots, setSlots] = useState<SlotOption[]>([]);
  // 初值从 sessionStorage 读 · 跨页面导航回来恢复
  const [activeSlotId, setActiveSlotIdRaw] = useState<number | null>(loadActiveSlotIdFromStorage);
  const setActiveSlotId = useCallback((next: number | null | ((prev: number | null) => number | null)) => {
    setActiveSlotIdRaw((prev) => {
      const v = typeof next === 'function' ? (next as (p: number | null) => number | null)(prev) : next;
      saveActiveSlotIdToStorage(v);
      return v;
    });
  }, []);
  const [switching, setSwitching] = useState(false);
  const [loading, setLoading] = useState(true);
  const slotsRef = useRef<SlotOption[]>([]);
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

  // 2026-04-28 · 不再 unmount 自动释放 · 改为持久化 + backend 30min idle 兜底
  // 用户切到广告/仪表盘等其他页 · 接管态保留 · 回来仍是同一个号

  // 重挂载时 · 如果 sessionStorage 有 activeSlotId · 静默 re-acquire (idempotent)
  // 兜底场景: 用户离开 30+ 分钟 backend idle 释放了 · 回来时重新拿
  const acquiredOnMountRef = useRef(false);
  useEffect(() => {
    if (acquiredOnMountRef.current) return;
    if (!activeSlotId || slots.length === 0) return;
    const slot = slots.find((s) => s.id === activeSlotId);
    if (!slot?.accountId) {
      // 持久化的 slotId 已不在当前列表 (slot 删了/重绑) · 清掉
      setActiveSlotId(null);
      return;
    }
    acquiredOnMountRef.current = true;
    // acquire 是幂等的: 同 user 持锁 → 返已有锁 · 锁空 → 新建. 不同 user → 403, 清状态
    void api
      .post(`/takeover/${slot.accountId}/acquire`, {})
      .then(() => {
        // 显式提示 · 不再静默 (老 bug: 用户不知道自己仍在接管 slot 2)
        message.info(`已恢复对 #${slot.slotIndex} (${slot.phoneNumber ?? '—'}) 的接管. 不需要请点 [释放]`);
      })
      .catch((err: { response?: { status?: number } }) => {
        if (err?.response?.status === 403) {
          message.warning('该号被其他用户接管中 · 已切回未接管状态');
          setActiveSlotId(null);
        }
      });
  }, [activeSlotId, slots, message, setActiveSlotId]);

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

  // 2026-04-28 · 软门控: online=true 直接进, online=false 也进 (chromium 进程可能仍活, ws 心跳暂时滞后)
  // 真画面没出来用户自己看得见, 不需要前端硬拦
  const canTakeover = !!activeSlot;

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

      {/* ── 块 B · 状态提示 (软提示 · 不阻塞) ──────────────── */}
      {activeSlot && !activeSlot.online && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="该号 backend 显离线"
          description="可能是 ws 心跳滞后 · 仍尝试打开窗口 · 若画面长时间无响应再去 '账号槽位' 重扫"
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
