// 2026-04-21 · 方案 C Dashboard 式重构
// · 顶部进度条 + 执行组区 + WhatsApp 风格 Logo + 信息齐全 + 空槽默认折叠
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Drawer,
  Dropdown,
  Empty,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { MenuProps } from 'antd';
import {
  RocketOutlined,
  EditOutlined,
  FolderOutlined,
  MessageOutlined,
  ExportOutlined,
  UndoOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { api, extractErrorMessage } from '@/lib/api';
import { useAuth } from '@/auth/AuthContext';
import { BindExistingModal } from './bind/BindExistingModal';
import { SelectProxyBeforeBindModal } from './bind/SelectProxyBeforeBindModal';
import { ChatModal } from './chat/ChatModal';
import { SimInfoModal } from './sim/SimInfoModal';
import { SimInfoBulkModal } from './sim/SimInfoBulkModal';

const { Title, Text, Paragraph } = Typography;

// 2026-04-25 · 加 quarantine · 440 明确判死 · UI 要显"号疑似被 WA 限制"
type SlotStatus = 'empty' | 'active' | 'suspended' | 'warmup' | 'quarantine';

// 2026-04-25 · D11-2 · slot 角色 (后端 backend 硬约束 · 每 tenant 至多 1 个 customer_service)
type SlotRole = 'broadcast' | 'customer_service';

interface SlotItem {
  id: number;
  tenantId: number;
  slotIndex: number;
  status: SlotStatus;
  role?: SlotRole; // D11-1 加 · 老数据 fallback broadcast
  online?: boolean;
  // 2026-04-25 · P1.6 · runtime 路径 · 决定哪些字段可信 (chromium 路径下 warmup/stats/nickname 暂未接)
  runtime?: 'baileys' | 'chromium';
  // 2026-04-25 · 稳定性 · 真实状态三指标
  suspendedUntil?: string | null;
  socketLastHeartbeatAt?: string | null;
  accountId: number | null;
  phoneNumber: string | null;
  waNickname: string | null;
  warmupStage: number | null;
  proxyId: number | null;
  profilePath: string | null;
  createdAt: string;
  // 2026-04-21 · 卡片增强数据
  warmupStartedAt?: string | null;
  warmupTotalDays?: number;
  warmupCurrentDay?: number;
  warmupProgressPct?: number;
  warmupPhase?: number | null;
  tasksExecuted?: number;
  contactsCount?: number;
  channelsCount?: number;
  groupsCount?: number;
  simInfo?: {
    countryCode?: string | null;
    carrierId?: string | null;
    customCarrierName?: string | null;
    customCountryName?: string | null;
    iccidSuffix?: string | null;
    notes?: string | null;
    displayCarrier?: string | null;
    displayCountry?: string | null;
    // 旧
    iccid?: string | null;
    carrier?: string | null;
    country?: string | null;
  } | null;
}

interface GroupSummary {
  id: number;
  name: string;
  description: string | null;
  memberCount: number;
  ipDistribution: Record<string, number>;
  duplicateIpGroups: Array<{ proxyKey: string; slotIds: number[] }>;
  slotIds: number[];
  createdAt: string;
  updatedAt: string;
}

const STATUS_META: Record<
  SlotStatus,
  { label: string; color: string; pct: string; bar: string }
> = {
  warmup: { label: '养号中', color: 'processing', pct: 'warmup', bar: '#1677ff' },
  active: { label: '运营中', color: 'success', pct: 'active', bar: '#25d366' },
  // 2026-04-22 · "封禁" 太吓人 · 改 "未连接" · 不等于 WA 真封号
  suspended: { label: '未连接', color: 'warning', pct: 'suspended', bar: '#faad14' },
  // 2026-04-25 · 连续 440 判死 · 不可自动恢复 · 必须换号
  quarantine: { label: '号疑似被限', color: 'error', pct: 'quarantine', bar: '#f5222d' },
  empty: { label: '空置', color: 'default', pct: 'empty', bar: '#d9d9d9' },
};

// 2026-04-25 · 健康度三色灯 · 根据心跳 + status 计算
// 🟢 healthy (心跳 < 90s · status=active/warmup)
// 🟡 degraded (心跳 90s-3min · 或 status=suspended 冷却中)
// 🔴 dead (心跳 > 3min · 或 status=quarantine/suspended 超冷却)
// ⚪ idle (空槽 · 或广告号 idle 待命)
//
// 2026-04-26 · 角色感知健康判定:
//   D12-3 设计: 客服号 always-on (auto-spawn) · 广告号 lazy-spawn (按需起 Chromium)
//   广告号 idle 时离线是预期行为 · 不应误报"红 dead" · 改成 idle 灰色"待命中"
function computeHealth(slot: SlotItem): { level: 'healthy' | 'degraded' | 'dead' | 'idle'; hint: string } {
  if (slot.status === 'empty') return { level: 'idle', hint: '空槽' };
  if (slot.status === 'quarantine') return { level: 'dead', hint: '号疑似被 WA 限制 · 需换号' };
  const hb = slot.socketLastHeartbeatAt ? new Date(slot.socketLastHeartbeatAt).getTime() : 0;
  const now = Date.now();
  const age = hb > 0 ? now - hb : Infinity;
  if (slot.status === 'suspended') {
    const until = slot.suspendedUntil ? new Date(slot.suspendedUntil).getTime() : 0;
    if (until > now) return { level: 'degraded', hint: `掉线冷却中 · ${Math.round((until - now) / 60000)} 分钟后可恢复` };
    return { level: 'dead', hint: '已挂线 · 等待系统重连' };
  }
  // active / warmup
  if (age < 90_000) return { level: 'healthy', hint: `心跳正常 (${Math.round(age / 1000)}s 前)` };
  if (age < 3 * 60_000) return { level: 'degraded', hint: `心跳延迟 ${Math.round(age / 1000)}s · 请关注` };
  // 心跳老 / 无心跳 — 按角色区分:
  //   广告号: 设计就是 idle 时不连 · 显灰色"待命中"不报警
  //   客服号: always-on 设计 · 真离线是真问题 · 显红
  if (slot.role !== 'customer_service') {
    return { level: 'idle', hint: '广告号 · 按需待命中 (跑任务时才连 Chromium · 节省内存)' };
  }
  return { level: 'dead', hint: `客服号心跳已 ${Math.round(age / 60000)} 分钟无响应 · 需排查` };
}

const HEALTH_COLOR = {
  healthy: '#25d366',
  degraded: '#faad14',
  dead: '#f5222d',
  idle: '#d9d9d9',
};

// 2026-04-21 · 用户提供的 WhatsApp 官方 logo 图 · 加右下数字角标
function WaLogo({ n, size = 40 }: { n: number; size?: number }) {
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        display: 'inline-flex',
      }}
    >
      <img
        src="/wa-logo.jpg"
        alt="WA"
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.22,
          objectFit: 'cover',
          boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: -4,
          bottom: -4,
          minWidth: size * 0.5,
          height: size * 0.5,
          borderRadius: size * 0.25,
          background: '#fff',
          border: '2px solid #25d366',
          color: '#128c7e',
          fontSize: size * 0.3,
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 4px',
        }}
      >
        {n}
      </div>
    </div>
  );
}

async function handleFactoryReset(slot: SlotItem, reload: () => Promise<void>): Promise<void> {
  await new Promise<void>((resolve) => {
    Modal.confirm({
      title: `⚠️ 原厂重置槽位 #${slot.slotIndex}`,
      width: 480,
      content: (
        <div>
          <p style={{ marginBottom: 8 }}>
            <strong>将清除该槽位所有数据</strong>, 包括:
          </p>
          <ul style={{ marginTop: 0, paddingLeft: 20, fontSize: 13 }}>
            <li>WhatsApp 账号 (手机号 {slot.phoneNumber ?? '—'}) 及所有聊天记录</li>
            <li>Session / 设备指纹 / 媒体文件</li>
            <li>健康分历史 / 风险事件</li>
          </ul>
          <p style={{ marginTop: 12, marginBottom: 0, fontSize: 13, color: '#666' }}>
            ✔ 保留: 代理绑定 · 组归属
            <br />
            ✔ 此操作不可撤销
          </p>
        </div>
      ),
      okText: '确认重置',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.post(`/slots/${slot.id}/clear`);
          message.success(`槽位 #${slot.slotIndex} 已重置`);
          await reload();
        } catch (err) {
          message.error(extractErrorMessage(err, '重置失败'));
        }
      },
      afterClose: resolve,
    });
  });
}

export function SlotsPage() {
  const { user, licenseStatus } = useAuth();
  const [slots, setSlots] = useState<SlotItem[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [proxyPickTarget, setProxyPickTarget] = useState<SlotItem | null>(null);
  const [bindTarget, setBindTarget] = useState<SlotItem | null>(null);
  // 2026-04-21 · M2 W3 · 新号注册走 pair code 模式 · 默认 qr 给现有号
  const [bindMode, setBindMode] = useState<'qr' | 'pairing-code'>('qr');
  const [chatTarget, setChatTarget] = useState<SlotItem | null>(null);
  const [groupEditor, setGroupEditor] = useState<GroupSummary | 'new' | null>(null);
  const [groupDrawerOpen, setGroupDrawerOpen] = useState(false);
  const [emptyExpanded, setEmptyExpanded] = useState(false);
  // 2026-04-22 · SIM 批量录入 Modal
  const [bulkSimOpen, setBulkSimOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [slotRes, groupRes] = await Promise.all([
        api.get<SlotItem[]>('/slots'),
        api.get<GroupSummary[]>('/execution-groups').catch(() => ({ data: [] as GroupSummary[] })),
      ]);
      setSlots(slotRes.data);
      setGroups(groupRes.data);
    } catch (err) {
      setError(extractErrorMessage(err, '加载槽位失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 2026-04-25 · D11-2 · 切换 slot 角色
  // backend 硬约束 · 后端拒第二个客服号 · 前端按 status 派发提示
  const handleToggleRole = useCallback(
    async (slot: SlotItem): Promise<void> => {
      const currentRole = slot.role ?? 'broadcast';
      const targetRole: SlotRole = currentRole === 'customer_service' ? 'broadcast' : 'customer_service';
      // 切到 customer_service 前 · 用 confirm 提醒 (backend 也会拦 · 这里只是 UX 缓冲)
      if (targetRole === 'customer_service') {
        const existingCS = slots.find(
          (s) => s.role === 'customer_service' && s.tenantId === slot.tenantId && s.id !== slot.id,
        );
        if (existingCS) {
          Modal.warning({
            title: '该租户已有客服号',
            content: (
              <Paragraph style={{ margin: 0 }}>
                槽位 #{existingCS.slotIndex} 当前是客服号 · 每租户至多 1 个客服号 · 请先把那个槽位改回广告号 · 才能把槽位 #{slot.slotIndex} 设为客服号.
              </Paragraph>
            ),
          });
          return;
        }
      }
      try {
        await api.patch<SlotItem>(`/slots/${slot.id}/role`, { role: targetRole });
        message.success(
          targetRole === 'customer_service'
            ? `槽位 #${slot.slotIndex} 已设为客服号 🛎️`
            : `槽位 #${slot.slotIndex} 已设为广告号 📢`,
        );
        void load();
      } catch (err) {
        // 后端错误语义: code=CUSTOMER_SERVICE_EXISTS / INVALID_ROLE / 404 etc
        const e = err as { response?: { status?: number; data?: { code?: string; message?: string } } };
        const code = e.response?.data?.code;
        const status = e.response?.status;
        if (code === 'CUSTOMER_SERVICE_EXISTS') {
          message.error(e.response?.data?.message ?? '该租户已有客服号');
        } else if (code === 'INVALID_ROLE') {
          message.error(e.response?.data?.message ?? '角色值不合法');
        } else if (status === 404) {
          message.error('槽位不存在');
        } else {
          message.error(extractErrorMessage(err, '切换角色失败'));
        }
      }
    },
    [slots, load],
  );

  const stats = useMemo(() => {
    const byStatus = { empty: 0, warmup: 0, active: 0, suspended: 0, pending_warmup: 0 } as Record<SlotStatus | 'pending_warmup', number>;
    slots.forEach((s) => {
      // status=warmup · 有 plan = 真养号中 · 无 plan = 待养号
      if (s.status === 'warmup' && !s.warmupStartedAt) {
        byStatus.pending_warmup += 1;
      } else {
        byStatus[s.status] += 1;
      }
    });
    return byStatus;
  }, [slots]);

  const activeSlots = useMemo(
    () => slots.filter((s) => s.status !== 'empty'),
    [slots],
  );
  const emptySlots = useMemo(() => slots.filter((s) => s.status === 'empty'), [slots]);
  // 2026-04-22 · 需处理的槽位 · 只看真"未连接" (backend 明确放弃的)
  // 不包括 active + online=false 的偶发抖动 · 那个系统自愈中 · 不打扰租户
  const problemSlots = useMemo(
    () => slots.filter((s) => s.accountId !== null && s.status === 'suspended'),
    [slots],
  );

  if (user?.tenantId === null) {
    return (
      <Alert
        type="info"
        showIcon
        message="平台超管视图"
        description="平台超级管理员没有自己的槽位。要查看具体租户的槽位，请前往 Admin → 租户管理。"
      />
    );
  }

  const total = slots.length || 1;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <Title level={4} style={{ margin: 0 }}>账号槽位</Title>
          <Text type="secondary">
            {licenseStatus?.tenantName} · {licenseStatus?.plan?.toUpperCase()} 套餐 · 上限 {licenseStatus?.slotLimit ?? '?'} 号
          </Text>
        </Space>
        <Space>
          <Badge count={groups.length} size="small" offset={[-4, 4]} color="#25d366">
            <Button size="small" onClick={() => setGroupDrawerOpen(true)}>
              📁 执行组
            </Button>
          </Badge>
          <Button
            size="small"
            onClick={() => setBulkSimOpen(true)}
            disabled={activeSlots.length === 0}
          >
            📝 批量填 SIM
          </Button>
          <Button size="small" onClick={() => void load()} loading={loading}>刷新</Button>
        </Space>
      </div>

      {/* 顶部概览 · 4 KPI 卡 + 合计进度条 · 2026-04-24 重构 */}
      <Card
        size="small"
        style={{ marginBottom: 16, boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}
        styles={{ body: { padding: 16 } }}
      >
        <Row gutter={12}>
          {([
            { key: 'warmup', icon: '👤', label: '养号中', value: stats.warmup, color: STATUS_META.warmup.bar, bg: '#f0f7ff' },
            { key: 'active', icon: '📈', label: '运营中', value: stats.active, color: STATUS_META.active.bar, bg: '#f0faf4' },
            { key: 'suspended', icon: '🔗', label: '未连接', value: stats.suspended, color: STATUS_META.suspended.bar, bg: '#fff7e6' },
            { key: 'empty', icon: '📦', label: '空置', value: stats.empty, color: STATUS_META.empty.bar, bg: '#fafafa' },
          ] as const).map((k) => (
            <Col key={k.key} xs={12} sm={6}>
              <div
                style={{
                  border: '1px solid #e8e8e8',
                  borderRadius: 8,
                  padding: '14px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  background: '#fff',
                }}
              >
                <div
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 10,
                    background: k.bg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 18,
                    flexShrink: 0,
                  }}
                >
                  {k.icon}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 2 }}>{k.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1, color: '#1f1f1f' }}>
                    {k.value}
                  </div>
                </div>
              </div>
            </Col>
          ))}
        </Row>

        {/* 进度条 · 各状态占比 */}
        <div
          style={{
            display: 'flex',
            height: 6,
            borderRadius: 3,
            overflow: 'hidden',
            marginTop: 16,
            background: '#f0f0f0',
          }}
        >
          {(['warmup', 'active', 'suspended', 'empty'] as SlotStatus[]).map((s) => {
            const n = stats[s];
            if (n === 0) return null;
            const pct = (n / total) * 100;
            return (
              <Tooltip key={s} title={`${STATUS_META[s].label} ${n} 个`}>
                <div style={{ width: `${pct}%`, background: STATUS_META[s].bar }} />
              </Tooltip>
            );
          })}
        </div>
        <div
          style={{
            textAlign: 'center',
            marginTop: 8,
            fontSize: 12,
            color: '#8c8c8c',
          }}
        >
          共 <strong style={{ color: '#333' }}>{slots.length}</strong> 槽位
        </div>
      </Card>

      {/* 2026-04-22 · 需处理槽位警示 · 批量操作入口 */}
      {problemSlots.length > 0 && (
        <ProblemSlotsPanel
          slots={problemSlots}
          onReload={load}
        />
      )}

      {/* 执行组 · 2026-04-24 挪到顶部按钮 + Drawer (方案 A) */}
      <Drawer
        title={
          <Space>
            <Text strong>📁 执行组管理</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>调度分组 · 多选方便</Text>
          </Space>
        }
        open={groupDrawerOpen}
        onClose={() => setGroupDrawerOpen(false)}
        width={560}
        extra={
          <Button type="primary" onClick={() => setGroupEditor('new')}>
            + 新建组
          </Button>
        }
      >
        {groups.length === 0 ? (
          <Empty
            description={
              <Space direction="vertical" size={4}>
                <Text type="secondary">还没有执行组</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  创建执行组后, 可对账号进行分组调度与批量操作
                </Text>
              </Space>
            }
          >
            <Button type="primary" onClick={() => setGroupEditor('new')}>
              创建第一个执行组
            </Button>
          </Empty>
        ) : (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            {groups.map((g) => (
              <Card key={g.id} size="small" hoverable bodyStyle={{ padding: 12 }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 6,
                  }}
                >
                  <Text strong>📁 {g.name}</Text>
                  <Space size={4}>
                    <Button size="small" type="link" onClick={() => setGroupEditor(g)}>
                      编辑
                    </Button>
                    <Popconfirm
                      title={`删除组「${g.name}」?`}
                      description="槽位本身不会被删 · 仅解除归属"
                      onConfirm={async () => {
                        try {
                          await api.delete(`/execution-groups/${g.id}`);
                          message.success('组已删除');
                          void load();
                        } catch (err) {
                          message.error(extractErrorMessage(err, '删除失败'));
                        }
                      }}
                    >
                      <Button size="small" type="link" danger>
                        删除
                      </Button>
                    </Popconfirm>
                  </Space>
                </div>
                <div style={{ fontSize: 12, color: '#666' }}>
                  成员 {g.memberCount} · IP {Object.keys(g.ipDistribution).length} 类
                  {g.duplicateIpGroups.length > 0 && (
                    <Tag color="orange" style={{ marginLeft: 4, fontSize: 10 }}>
                      ⚠ 含同 IP
                    </Tag>
                  )}
                </div>
                <div style={{ marginTop: 6 }}>
                  {g.slotIds.slice(0, 12).map((sid) => {
                    const s = slots.find((x) => x.id === sid);
                    return (
                      <Tag key={sid} style={{ marginInlineEnd: 4, fontSize: 11 }}>
                        #{s?.slotIndex ?? '?'}
                      </Tag>
                    );
                  })}
                  {g.slotIds.length > 12 && (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      +{g.slotIds.length - 12}
                    </Text>
                  )}
                </div>
              </Card>
            ))}
          </Space>
        )}
      </Drawer>

      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

      {loading && slots.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin size="large" />
        </div>
      ) : slots.length === 0 ? (
        <Empty description="还没有槽位 — 请联系管理员重新激活 License" />
      ) : (
        <>
          {/* 2026-04-26 · 空槽 · 置顶 (用户令: 号越多空槽越往下沉 · 租户看不到绑号入口) */}
          {emptySlots.length > 0 && (
            <Card
              size="small"
              title={
                <Space>
                  <Text strong>空槽位</Text>
                  <Tag color="default">{emptySlots.length}</Tag>
                </Space>
              }
              extra={
                <Button size="small" type="link" onClick={() => setEmptyExpanded(!emptyExpanded)}>
                  {emptyExpanded ? '收起 ▲' : '展开 ▼'}
                </Button>
              }
              style={{
                marginBottom: 12,
                // 高亮: 浅绿底 + 品牌绿左 border · 让租户一眼看到绑号入口
                background: '#f0faf4',
                borderLeft: '4px solid #25d366',
              }}
            >
              {!emptyExpanded ? (
                <Paragraph type="secondary" style={{ margin: 0, fontSize: 13 }}>
                  📦 {emptySlots.length} 个空槽待启用 · 点"展开"查看 · 或直接点下方按钮启用:
                  <br />
                  <Space style={{ marginTop: 8 }}>
                    <Button
                      size="small"
                      type="primary"
                      onClick={() => {
                        setBindMode('qr');
                        setProxyPickTarget(emptySlots[0]);
                      }}
                    >
                      📷 扫码绑定现有号 (#{emptySlots[0].slotIndex})
                    </Button>
                    <Button
                      size="small"
                      onClick={() => {
                        setBindMode('pairing-code');
                        setProxyPickTarget(emptySlots[0]);
                      }}
                    >
                      🔗 配对码链接 (#{emptySlots[0].slotIndex})
                    </Button>
                  </Space>
                </Paragraph>
              ) : (
                <Row gutter={[6, 6]}>
                  {emptySlots.map((slot) => (
                    <Col key={slot.id} xs={12} sm={8} md={6} lg={4} xl={3}>
                      <EmptySlotMini
                        slot={slot}
                        onEnableQR={() => {
                          setBindMode('qr');
                          setProxyPickTarget(slot);
                        }}
                        onEnablePairCode={() => {
                          setBindMode('pairing-code');
                          setProxyPickTarget(slot);
                        }}
                      />
                    </Col>
                  ))}
                </Row>
              )}
            </Card>
          )}

          {/* 活跃槽位 · 详细卡 */}
          {activeSlots.length > 0 && (
            <Card
              size="small"
              title={<Text strong>活跃槽位 · {activeSlots.length} 个</Text>}
              style={{ marginBottom: 12 }}
            >
              <Row gutter={[12, 12]}>
                {activeSlots.map((slot) => (
                  <Col key={slot.id} xs={24} sm={12} md={8} xl={6}>
                    <ActiveSlotCard
                      slot={slot}
                      groups={groups}
                      activeSlots={activeSlots}
                      onManage={() => setChatTarget(slot)}
                      onFactoryReset={() => void handleFactoryReset(slot, load)}
                      onReload={() => void load()}
                    />
                  </Col>
                ))}
              </Row>
            </Card>
          )}
        </>
      )}

      {proxyPickTarget && (
        <SelectProxyBeforeBindModal
          slotId={proxyPickTarget.id}
          slotIndex={proxyPickTarget.slotIndex}
          currentProxyId={proxyPickTarget.proxyId}
          open={!!proxyPickTarget}
          onClose={() => setProxyPickTarget(null)}
          onReady={() => {
            setBindTarget(proxyPickTarget);
            setProxyPickTarget(null);
          }}
        />
      )}
      {bindTarget && (
        <BindExistingModal
          slotId={bindTarget.id}
          slotIndex={bindTarget.slotIndex}
          open={!!bindTarget}
          initialMode={bindMode}
          onClose={() => setBindTarget(null)}
          onSuccess={() => {
            setBindTarget(null);
            // R5 修 · 第一次 reload 拿到的可能是 placeholder phone (pending-XX-timestamp)
            // backend 在 connected 后 2-3s 异步 fetch-account-info 替换真号
            // 5s 后再 reload 一次 · UI 直接显真号 · 用户不必 F5
            void load();
            setTimeout(() => void load(), 5000);
          }}
        />
      )}
      {chatTarget && (
        <ChatModal
          slotId={chatTarget.id}
          slotIndex={chatTarget.slotIndex}
          phoneNumber={chatTarget.phoneNumber}
          open={!!chatTarget}
          onClose={() => setChatTarget(null)}
        />
      )}
      <SimInfoBulkModal
        open={bulkSimOpen}
        onClose={() => setBulkSimOpen(false)}
        onSaved={() => {
          setBulkSimOpen(false);
          void load();
        }}
        slots={activeSlots.map((s) => ({
          id: s.id,
          slotIndex: s.slotIndex,
          phoneNumber: s.phoneNumber,
          status: s.status,
        }))}
      />
      {groupEditor && (
        <GroupEditorModal
          mode={groupEditor === 'new' ? 'new' : 'edit'}
          group={groupEditor === 'new' ? null : groupEditor}
          allSlots={slots}
          open={!!groupEditor}
          onClose={() => setGroupEditor(null)}
          onSaved={() => {
            setGroupEditor(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function ActiveSlotCard({
  slot,
  groups,
  activeSlots,
  onManage,
  onFactoryReset,
  onReload,
}: {
  slot: SlotItem;
  groups: GroupSummary[];
  activeSlots: SlotItem[];
  onManage: () => void;
  onFactoryReset: () => void;
  onReload: () => void;
}) {
  // 2026-04-22 · 区分 "待养号" (status=warmup 但无 plan) vs "养号中" (有 plan)
  const hasWarmupPlan = !!slot.warmupStartedAt;
  // 2026-04-26 · 角色感知 meta: 广告号 idle 时显"待命中" 蓝灰 · 不显"运营中"绿
  //   D12-3 设计: 广告号 lazy-spawn · idle = 节省内存 · 不是离线
  const baseMeta =
    slot.status === 'warmup' && !hasWarmupPlan
      ? { label: '待养号', color: 'default', bar: '#d9d9d9', pct: 'warmup' }
      : STATUS_META[slot.status];
  const isAdIdle =
    slot.status === 'active' && slot.role !== 'customer_service' && slot.online === false;
  const meta = isAdIdle
    ? { label: '待命中', color: 'blue', bar: '#1677ff', pct: baseMeta.pct }
    : baseMeta;
  // 2026-04-25 · 稳定性 · 健康度 · 显示三色灯 (2026-04-26 · 改成角色感知)
  const health = computeHealth(slot);
  const memberGroups = groups.filter((g) => g.slotIds.includes(slot.id));
  const [warmupWizardOpen, setWarmupWizardOpen] = useState(false);
  const [groupMembershipOpen, setGroupMembershipOpen] = useState(false);
  const [simModalOpen, setSimModalOpen] = useState(false);
  // 2026-04-22 · 封禁诊断
  const [diagnosisOpen, setDiagnosisOpen] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      const r = await api.post<{ ok: boolean; message: string }>(`/slots/${slot.id}/reconnect`);
      if (r.data.ok) {
        message.success(r.data.message);
        setTimeout(onReload, 3000);
      } else {
        message.error(r.data.message);
      }
    } catch (err) {
      message.error(extractErrorMessage(err));
    } finally {
      setReconnecting(false);
    }
  };

  const menu: MenuProps['items'] = [
    {
      key: 'warmup',
      icon: <RocketOutlined style={{ color: '#f5222d' }} />,
      label: '一键养号',
      onClick: () => setWarmupWizardOpen(true),
    },
    { type: 'divider' },
    {
      key: 'sim-info',
      icon: slot.simInfo?.displayCarrier
        ? <EditOutlined style={{ color: '#fa8c16' }} />
        : <PlusOutlined style={{ color: '#fa8c16' }} />,
      label: slot.simInfo?.displayCarrier ? '编辑 SIM 信息' : '填 SIM 信息',
      onClick: () => setSimModalOpen(true),
    },
    {
      key: 'group-membership',
      icon: memberGroups.length > 0
        ? <FolderOutlined style={{ color: '#faad14' }} />
        : <PlusOutlined style={{ color: '#faad14' }} />,
      label: memberGroups.length > 0 ? `管理执行组 (${memberGroups.length})` : '加入执行组',
      onClick: () => setGroupMembershipOpen(true),
    },
    { type: 'divider' },
    {
      type: 'group',
      label: '管理 / 聊天',
      children: [
        {
          key: 'manage',
          icon: <MessageOutlined style={{ color: '#25d366' }} />,
          label: '管理 / 聊天',
          onClick: onManage,
        },
        {
          key: 'handover',
          icon: <ExportOutlined style={{ color: '#1677ff' }} />,
          label: '转出到手机 (导出 + 解绑)',
          onClick: () => {
        Modal.confirm({
          title: `📤 转出 #${slot.slotIndex} 到手机`,
          width: 560,
          content: (
            <div>
              <p style={{ marginBottom: 8 }}>
                WA 号转手机 · <strong>SIM 插手机 + SMS OTP</strong> 即可 · 不需扫老设备 QR.
              </p>
              <p style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>
                但 Baileys 聊天数据不兼容 WA 官方备份 · 先下载再说:
              </p>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Button size="small" onClick={() => window.open(`/api/v1/slots/${slot.id}/export/chats.txt`)}>
                  💬 下载聊天记录 (chats.txt)
                </Button>
                <Button size="small" onClick={() => window.open(`/api/v1/slots/${slot.id}/export/contacts.csv`)}>
                  📇 下载联系人 (contacts.csv)
                </Button>
                <Button size="small" onClick={() => window.open(`/api/v1/slots/${slot.id}/export/channels-groups.txt`)}>
                  📢 下载频道/群列表
                </Button>
              </Space>
              <p style={{ marginTop: 12, fontSize: 12, color: '#999' }}>
                转移流程: ① SIM 插手机 → ② 装 WhatsApp 用 SMS OTP → ③ 系统这边会自动检测号在别处登录 · 自动解绑.
              </p>
            </div>
          ),
          okText: '我已完成转移 · 原厂重置',
          cancelText: '稍后再说',
          onOk: onFactoryReset,
        });
      },
        },
      ],
    },
    { type: 'divider' },
    {
      key: 'factory-reset',
      icon: <UndoOutlined />,
      label: '原厂重置',
      danger: true,
      onClick: onFactoryReset,
    },
  ];

  // 2026-04-26 · R-UI · 完全依照参考图重写卡片 · 大字号手机号 / 分隔线 / 整齐排列
  const phoneReady = slot.phoneNumber && !slot.phoneNumber.startsWith('pending-');
  const dividerStyle: CSSProperties = {
    borderTop: '1px solid #f0f0f0',
    margin: '12px 0',
  };
  const labelStyle: CSSProperties = { color: '#8c8c8c', fontSize: 12, fontWeight: 400 };
  const valueStyle: CSSProperties = { color: '#262626', fontSize: 13 };

  return (
    <Card
      size="small"
      style={{ borderLeft: `4px solid ${meta.bar}`, borderRadius: 8 }}
      styles={{ body: { padding: '14px 16px' } }}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <WaLogo n={slot.slotIndex} size={36} />
          <Tag color={meta.color} style={{ margin: 0, fontSize: 12, padding: '2px 10px', borderRadius: 12, fontWeight: 500 }}>
            {meta.label}
          </Tag>
          {slot.accountId && (
            <Tooltip title={health.hint}>
              <span
                style={{
                  display: 'inline-block',
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: HEALTH_COLOR[health.level],
                  boxShadow: `0 0 4px ${HEALTH_COLOR[health.level]}`,
                }}
              />
            </Tooltip>
          )}
          {memberGroups.map((g) => (
            <Tag
              key={g.id}
              color="blue"
              closable
              style={{ margin: 0, fontSize: 12, padding: '1px 8px', borderRadius: 10 }}
              onClose={async (e) => {
                e.preventDefault();
                try {
                  const nextSlotIds = g.slotIds.filter((sid) => sid !== slot.id);
                  await api.patch(`/execution-groups/${g.id}`, {
                    name: g.name,
                    description: g.description ?? undefined,
                    slotIds: nextSlotIds,
                  });
                  message.success(`已退出「${g.name}」`);
                  onReload();
                } catch (err) {
                  message.error(extractErrorMessage(err));
                }
              }}
            >
              📁 {g.name}
            </Tag>
          ))}
        </div>
      }
      extra={
        <Dropdown
          menu={{ items: menu, style: { fontSize: 13, minWidth: 200 } }}
          trigger={['click']}
        >
          <Button size="small" type="link" style={{ fontSize: 13, fontWeight: 500 }}>操作 ▾</Button>
        </Dropdown>
      }
    >
      {/* 状态告警 (suspended / 同步中) */}
      {slot.status === 'suspended' && (
        <Alert
          type="error"
          showIcon
          style={{ padding: '6px 10px', fontSize: 12, marginBottom: 10 }}
          message={
            <Space size={6} wrap>
              <Text style={{ fontSize: 12 }}>⚠ 连接被 WA 拒绝</Text>
              <Button type="link" size="small" loading={reconnecting} onClick={handleReconnect} style={{ padding: 0, fontSize: 12, height: 'auto' }}>
                🔄 重连
              </Button>
              <Button type="link" size="small" onClick={() => setDiagnosisOpen(true)} style={{ padding: 0, fontSize: 12, height: 'auto' }}>
                💡 诊断
              </Button>
            </Space>
          }
        />
      )}
      {/* 2026-04-26 · 角色感知"同步中"警告:
            - 客服号 always-on 离线 → 真问题 · 显警告
            - 广告号 idle 离线 → 预期行为 · 不显警告 (不打扰租户)
            - 广告号有 active task 但离线 → 显警告 (跑任务时该连)
       */}
      {(slot.status === 'active' || slot.status === 'warmup') &&
        slot.online === false &&
        slot.role === 'customer_service' && (
          <Alert
            type="info"
            showIcon
            style={{ padding: '6px 10px', fontSize: 12, marginBottom: 10 }}
            message={
              <Space size={6} wrap>
                <Text style={{ fontSize: 12 }}>🔄 客服号离线 · 正在同步连接...</Text>
                <Button type="link" size="small" loading={reconnecting} onClick={handleReconnect} style={{ padding: 0, fontSize: 12, height: 'auto' }}>
                  立刻刷新
                </Button>
              </Space>
            }
          />
        )}

      {/* ── 主信息块 ────────────────── */}
      {/* 📞 手机号 (大字号 · 主焦点) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 18 }}>📞</span>
        {phoneReady ? (
          <span style={{ fontSize: 22, fontWeight: 600, color: '#262626', letterSpacing: 0.3 }}>
            {slot.phoneNumber}
          </span>
        ) : (
          <Text type="secondary" style={{ fontSize: 14 }}>拉取真号中...</Text>
        )}
      </div>

      {/* chromium 路径 nickname 暂未接 · hide */}
      {slot.runtime !== 'chromium' && slot.waNickname && (
        <div style={{ ...valueStyle, marginBottom: 6, paddingLeft: 26 }}>
          👤 {slot.waNickname}
        </div>
      )}

      {/* 📶 SIM 信息行 */}
      {slot.simInfo?.displayCarrier ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, ...valueStyle }}>
          <span>📶</span>
          <span style={{ fontWeight: 500 }}>{slot.simInfo.displayCarrier}</span>
          {slot.simInfo.iccidSuffix && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              · ...{slot.simInfo.iccidSuffix.slice(-6)}
            </Text>
          )}
          {slot.simInfo.displayCountry && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              · {slot.simInfo.displayCountry}
            </Text>
          )}
          <Button
            type="link"
            size="small"
            style={{ padding: 0, fontSize: 12, marginLeft: 'auto', color: '#8c8c8c' }}
            onClick={() => setSimModalOpen(true)}
          >
            ✏
          </Button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <Text type="secondary" style={{ fontSize: 13 }}>📶 未填 SIM 信息</Text>
          <Button type="link" size="small" style={{ padding: 0, fontSize: 12 }} onClick={() => setSimModalOpen(true)}>
            ➕ 填写
          </Button>
        </div>
      )}

      {/* 🌐 网络出口 */}
      <div style={{ ...valueStyle, marginBottom: 10 }}>
        🌐{' '}
        {slot.proxyId === null ? (
          <Text type="secondary" style={{ fontSize: 13 }}>直连 (本机 IP)</Text>
        ) : (
          <span>代理 #{slot.proxyId}</span>
        )}
      </div>

      {/* 角色 pill + 切换 button (并列两个 pill) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        {slot.role === 'customer_service' ? (
          <Tag color="green" style={{ margin: 0, fontSize: 12, padding: '3px 12px', borderRadius: 14, fontWeight: 500 }}>
            🛎️ 客服号 · always-on
          </Tag>
        ) : (
          <Tag color="blue" style={{ margin: 0, fontSize: 12, padding: '3px 12px', borderRadius: 14, fontWeight: 500 }}>
            📢 广告号
          </Tag>
        )}
        <Button
          size="small"
          onClick={() => void handleToggleRole(slot)}
          style={{ fontSize: 12, padding: '0 10px', height: 24, borderRadius: 12 }}
        >
          ⇄ 切换
        </Button>
      </div>

      {/* ── 养号进度区 (有 plan 才显) ────────────────── */}
      {slot.warmupStartedAt && (slot.warmupCurrentDay ?? 0) > 0 && (
        <>
          <div style={dividerStyle} />
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: '#262626' }}>
                🌱 养号 Day {slot.warmupCurrentDay ?? 0} / {slot.warmupTotalDays ?? 14}
              </span>
              <span style={{ fontSize: 12, color: '#8c8c8c' }}>
                Phase {slot.warmupPhase ?? 0}
              </span>
            </div>
            <Progress
              percent={slot.warmupProgressPct ?? 0}
              size="small"
              strokeColor={{ from: '#25d366', to: '#128c7e' }}
              showInfo={false}
              style={{ marginBottom: 4 }}
            />
            <div style={{ fontSize: 11, color: '#bfbfbf' }}>
              起于 {new Date(slot.warmupStartedAt).toLocaleDateString('zh-CN')}
            </div>
          </div>
        </>
      )}

      {/* ── 统计区 (4 列等宽) ────────────────── */}
      <div style={dividerStyle} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
        <Tooltip title={slot.runtime === 'chromium' ? '该统计在 Chromium 路径暂未接通 · 跑通后恢复' : '任务 run 数 + 发消息数'}>
          <div style={{ textAlign: 'center' }}>
            <div style={labelStyle}>任务</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: slot.runtime === 'chromium' ? '#bfbfbf' : '#1677ff', marginTop: 2 }}>
              {slot.runtime === 'chromium' ? '—' : (slot.tasksExecuted ?? 0)}
            </div>
          </div>
        </Tooltip>
        <Tooltip title={slot.runtime === 'chromium' ? '该统计在 Chromium 路径暂未接通' : '联系人数'}>
          <div style={{ textAlign: 'center' }}>
            <div style={labelStyle}>联系人</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: slot.runtime === 'chromium' ? '#bfbfbf' : '#52c41a', marginTop: 2 }}>
              {slot.runtime === 'chromium' ? '—' : (slot.contactsCount ?? 0)}
            </div>
          </div>
        </Tooltip>
        <Tooltip title={slot.runtime === 'chromium' ? '该统计在 Chromium 路径暂未接通' : '已加群数'}>
          <div style={{ textAlign: 'center' }}>
            <div style={labelStyle}>群</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: slot.runtime === 'chromium' ? '#bfbfbf' : '#722ed1', marginTop: 2 }}>
              {slot.runtime === 'chromium' ? '—' : (slot.groupsCount ?? 0)}
            </div>
          </div>
        </Tooltip>
        <Tooltip title={slot.runtime === 'chromium' ? '该统计在 Chromium 路径暂未接通' : '已 Follow 频道数'}>
          <div style={{ textAlign: 'center' }}>
            <div style={labelStyle}>频道</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: slot.runtime === 'chromium' ? '#bfbfbf' : '#fa541c', marginTop: 2 }}>
              {slot.runtime === 'chromium' ? '—' : (slot.channelsCount ?? 0)}
            </div>
          </div>
        </Tooltip>
      </div>

      <WarmupWizardModal
        slot={slot}
        groups={groups}
        activeSlots={activeSlots}
        open={warmupWizardOpen}
        onClose={() => setWarmupWizardOpen(false)}
      />
      <GroupMembershipModal
        slot={slot}
        groups={groups}
        open={groupMembershipOpen}
        onClose={() => setGroupMembershipOpen(false)}
        onSaved={() => {
          setGroupMembershipOpen(false);
          onReload();
        }}
      />
      <SimInfoModal
        open={simModalOpen}
        onClose={() => setSimModalOpen(false)}
        onSaved={() => {
          setSimModalOpen(false);
          onReload();
        }}
        slotId={slot.id}
        slotIndex={slot.slotIndex}
        phoneNumber={slot.phoneNumber}
        initial={slot.simInfo ?? null}
      />
      <DiagnosisModal
        open={diagnosisOpen}
        onClose={() => setDiagnosisOpen(false)}
        slotId={slot.id}
        slotIndex={slot.slotIndex}
        onReconnect={handleReconnect}
      />
    </Card>
  );
}

// 2026-04-22 · 连接诊断 Modal
function DiagnosisModal({
  open,
  onClose,
  slotId,
  slotIndex,
  onReconnect,
}: {
  open: boolean;
  onClose: () => void;
  slotId: number;
  slotIndex: number;
  onReconnect: () => Promise<void> | void;
}) {
  const [diagnosis, setDiagnosis] = useState<{
    online: boolean;
    status: string;
    lastCloseCode: number | null;
    lastCloseAt: string | null;
    count440: number;
    countTimeout: number;
    issues: string[];
    suggestions: string[];
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api
      .get(`/slots/${slotId}/connection-diagnosis`)
      .then((r) => setDiagnosis(r.data as typeof diagnosis))
      .catch(() => setDiagnosis(null))
      .finally(() => setLoading(false));
  }, [open, slotId]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={`💡 连接诊断 · #${slotIndex}`}
      footer={[
        <Button key="c" onClick={onClose}>关闭</Button>,
        <Button key="r" type="primary" onClick={() => void onReconnect()}>
          🔄 立刻重连
        </Button>,
      ]}
      width={560}
    >
      {loading || !diagnosis ? (
        <Spin />
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Alert
            type={diagnosis.online ? 'success' : 'warning'}
            message={
              <span>
                Pool 在线: <strong>{diagnosis.online ? '是' : '否'}</strong> ·
                DB 状态: <strong>{diagnosis.status}</strong>
              </span>
            }
          />
          {diagnosis.lastCloseCode && (
            <div style={{ fontSize: 12 }}>
              <Text strong>最近断连</Text>: code=<code>{diagnosis.lastCloseCode}</code>{' '}
              at {new Date(diagnosis.lastCloseAt!).toLocaleString()}
              {diagnosis.count440 > 0 && (
                <div>· 近期 440 冲突 {diagnosis.count440} 次</div>
              )}
              {diagnosis.countTimeout > 0 && (
                <div>· 近期超时 {diagnosis.countTimeout} 次</div>
              )}
            </div>
          )}

          {diagnosis.issues.length > 0 && (
            <div>
              <Text strong style={{ fontSize: 13 }}>🔍 问题</Text>
              <ul style={{ marginTop: 4, paddingLeft: 20, fontSize: 12 }}>
                {diagnosis.issues.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}

          {diagnosis.suggestions.length > 0 && (
            <div>
              <Text strong style={{ fontSize: 13 }}>💡 建议</Text>
              <ul style={{ marginTop: 4, paddingLeft: 20, fontSize: 12 }}>
                {diagnosis.suggestions.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </div>
          )}

          {diagnosis.issues.length === 0 && diagnosis.online && (
            <Alert
              type="success"
              message="一切正常 · 连接稳定"
            />
          )}
        </Space>
      )}
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════
// 执行组成员管理 · 勾选加入 / 退出 (2026-04-22)
// ════════════════════════════════════════════════════════════════════
function GroupMembershipModal({
  slot,
  groups,
  open,
  onClose,
  onSaved,
}: {
  slot: SlotItem;
  groups: GroupSummary[];
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initialSelected = useMemo(
    () => new Set(groups.filter((g) => g.slotIds.includes(slot.id)).map((g) => g.id)),
    [groups, slot.id],
  );
  const [selected, setSelected] = useState<Set<number>>(initialSelected);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setSelected(new Set(initialSelected));
  }, [open, initialSelected]);

  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const tasks: Promise<unknown>[] = [];
      for (const g of groups) {
        const wasMember = initialSelected.has(g.id);
        const isMember = selected.has(g.id);
        if (wasMember === isMember) continue;
        const nextSlotIds = isMember
          ? Array.from(new Set([...g.slotIds, slot.id]))
          : g.slotIds.filter((sid) => sid !== slot.id);
        tasks.push(
          api.patch(`/execution-groups/${g.id}`, {
            name: g.name,
            description: g.description ?? undefined,
            slotIds: nextSlotIds,
          }),
        );
      }
      if (tasks.length === 0) {
        message.info('没有变化');
        onClose();
        return;
      }
      await Promise.all(tasks);
      message.success('执行组成员已更新');
      onSaved();
    } catch (err) {
      message.error(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={`📁 管理执行组 · #${slot.slotIndex} · ${slot.phoneNumber ?? ''}`}
      onOk={handleSave}
      confirmLoading={saving}
      okText="保存"
      cancelText="取消"
      destroyOnClose
    >
      {groups.length === 0 ? (
        <Empty description="还没有执行组 · 请先到 '执行组' 区创建" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            勾选要加入的组 · 取消勾选即退出.
          </Text>
          {groups.map((g) => {
            const checked = selected.has(g.id);
            return (
              <label
                key={g.id}
                style={{
                  cursor: 'pointer',
                  padding: 10,
                  border: `2px solid ${checked ? '#25d366' : '#e5e5e5'}`,
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(g.id)}
                />
                <div style={{ flex: 1 }}>
                  <div>
                    <strong>📁 {g.name}</strong>{' '}
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      · {g.memberCount} 号
                    </Text>
                  </div>
                  {g.description && (
                    <div style={{ fontSize: 11, color: '#999' }}>{g.description}</div>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════
// 一键养号向导 (V1.1 pending) · 当前只占位 UI
// ════════════════════════════════════════════════════════════════════

function WarmupWizardModal({
  slot,
  groups,
  activeSlots,
  open,
  onClose,
}: {
  slot: SlotItem;
  groups: GroupSummary[];
  activeSlots: SlotItem[];
  open: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'join-group' | 'ad-hoc-pair' | 'solo'>('join-group');
  const [groupId, setGroupId] = useState<number | null>(null);
  const [partnerId, setPartnerId] = useState<number | null>(null);
  const [template, setTemplate] = useState<'v1_7day' | 'v1_14day_full'>('v1_14day_full');
  const [submitting, setSubmitting] = useState(false);

  const handleStart = async () => {
    if (mode === 'join-group') {
      if (!groupId) {
        message.warning('请选择一个执行组');
        return;
      }
      setSubmitting(true);
      try {
        await api.post('/group-warmup/start', { groupId, template });
        message.success(`🚀 养号计划已启动 · 组 #${groupId} · ${template === 'v1_14day_full' ? '14 天全托管' : '7 天养号'}`);
        onClose();
      } catch (err) {
        message.error(extractErrorMessage(err));
      } finally {
        setSubmitting(false);
      }
    } else if (mode === 'ad-hoc-pair') {
      message.info('🚧 临时配对模式 · 下版本接入 · 建议先把 2 号加入同一执行组');
    } else {
      message.warning('⚠ 单号被动模式 · Phase 1 封顶 · 建议至少 2 号组队');
    }
  };

  const candidatePartners = activeSlots.filter((s) => s.id !== slot.id);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={`🚀 启动自动养号 · #${slot.slotIndex} · ${slot.phoneNumber ?? ''}`}
      width={560}
      footer={[
        <Button key="c" onClick={onClose}>取消</Button>,
        <Button key="s" type="primary" loading={submitting} onClick={handleStart}>
          立刻启动
        </Button>,
      ]}
      destroyOnClose
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8, fontSize: 13 }}>
          <strong>托管模板</strong>
        </div>
        <Select
          value={template}
          onChange={(v) => setTemplate(v)}
          style={{ width: '100%' }}
          options={[
            { value: 'v1_14day_full', label: '🚀 一键托管 · 14 天 (7 天养号 + 7 天运营热身 · 推荐)' },
            { value: 'v1_7day', label: '🌱 纯养号 · 7 天 (养完进成熟常态)' },
          ]}
        />
      </div>
      <div style={{ marginBottom: 16, fontSize: 13, color: '#666' }}>
        养号需要 ≥ 2 号互聊才完整 · 选一种:
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ cursor: 'pointer', padding: 12, border: `2px solid ${mode === 'join-group' ? '#25d366' : '#e5e5e5'}`, borderRadius: 6 }}>
          <input type="radio" name="warmup-mode" checked={mode === 'join-group'} onChange={() => setMode('join-group')} style={{ marginRight: 8 }} />
          <strong>🤝 加入现有养号组</strong>
          {mode === 'join-group' && (
            <div style={{ marginTop: 8, marginLeft: 22 }}>
              {groups.length === 0 ? (
                <Text type="warning">还没有执行组 · 先去"执行组"区创建</Text>
              ) : (
                <select value={groupId ?? ''} onChange={(e) => setGroupId(e.target.value ? parseInt(e.target.value, 10) : null)} style={{ width: '100%', padding: 4 }}>
                  <option value="">选择一个 group</option>
                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name} · {g.memberCount} 号</option>)}
                </select>
              )}
            </div>
          )}
        </label>

        <label style={{ cursor: 'pointer', padding: 12, border: `2px solid ${mode === 'ad-hoc-pair' ? '#25d366' : '#e5e5e5'}`, borderRadius: 6 }}>
          <input type="radio" name="warmup-mode" checked={mode === 'ad-hoc-pair'} onChange={() => setMode('ad-hoc-pair')} style={{ marginRight: 8 }} />
          <strong>🤝 和另一个号临时配对</strong>
          {mode === 'ad-hoc-pair' && (
            <div style={{ marginTop: 8, marginLeft: 22 }}>
              {candidatePartners.length === 0 ? (
                <Text type="warning">还没有其他活跃号 · 先绑更多号</Text>
              ) : (
                <select value={partnerId ?? ''} onChange={(e) => setPartnerId(e.target.value ? parseInt(e.target.value, 10) : null)} style={{ width: '100%', padding: 4 }}>
                  <option value="">选择 partner 号</option>
                  {candidatePartners.map((s) => <option key={s.id} value={s.id}>#{s.slotIndex} · {s.phoneNumber ?? '未命名'}</option>)}
                </select>
              )}
            </div>
          )}
        </label>

        <label style={{ cursor: 'pointer', padding: 12, border: `2px solid ${mode === 'solo' ? '#faad14' : '#e5e5e5'}`, borderRadius: 6 }}>
          <input type="radio" name="warmup-mode" checked={mode === 'solo'} onChange={() => setMode('solo')} style={{ marginRight: 8 }} />
          <strong>🌱 仅单号被动养号</strong>
          <div style={{ fontSize: 12, color: '#faad14', marginTop: 4, marginLeft: 22 }}>
            ⚠ 只跑挂载 / 浏览 status / 发 status · <strong>无互聊</strong> · 效果差 50%<br />
            ⚠ Phase 1 封顶 · 进不了 Phase 2 (激活)
          </div>
        </label>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginTop: 16, fontSize: 12 }}
        message="📋 养号方案 · 7 天标准模板 (v1_7day)"
        description="孵化 Day1-2 (只挂载) → 破壳 Day3-4 (浏览+首次互聊) → 激活 Day5-7 (高频互聊+发 status) → Day8+ 成熟常态"
      />
    </Modal>
  );
}

// 2026-04-22 · 需处理槽位面板 · 批量选 + 批量重连
function ProblemSlotsPanel({
  slots,
  onReload,
}: {
  slots: SlotItem[];
  onReload: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [processing, setProcessing] = useState(false);

  const toggleAll = () => {
    if (selected.size === slots.length) setSelected(new Set());
    else setSelected(new Set(slots.map((s) => s.id)));
  };
  const toggleOne = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const handleBatchReconnect = async () => {
    const ids = selected.size > 0 ? Array.from(selected) : slots.map((s) => s.id);
    setProcessing(true);
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      try {
        await api.post(`/slots/${id}/reconnect`);
        ok++;
      } catch {
        fail++;
      }
    }
    message.success(`批量重连 · 成功 ${ok} · 失败 ${fail}`);
    setProcessing(false);
    setSelected(new Set());
    setTimeout(() => void onReload(), 3000);
  };

  return (
    <Card
      size="small"
      style={{ marginBottom: 12, borderColor: '#faad14' }}
      title={
        <Space>
          <Text strong style={{ color: '#d48806' }}>⚠ 需处理槽位 · {slots.length} 个</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            连接长时间未恢复 · 可批量重连
          </Text>
        </Space>
      }
      extra={
        <Space>
          <Button
            size="small"
            onClick={toggleAll}
          >
            {selected.size === slots.length ? '取消全选' : '全选'}
          </Button>
          <Button
            size="small"
            type="primary"
            loading={processing}
            onClick={handleBatchReconnect}
          >
            🔄 {selected.size > 0 ? `批量重连 (${selected.size})` : `全部重连 (${slots.length})`}
          </Button>
        </Space>
      }
    >
      <Row gutter={[8, 8]}>
        {slots.map((s) => (
          <Col key={s.id} xs={12} sm={8} md={6} lg={4}>
            <div
              onClick={() => toggleOne(s.id)}
              style={{
                cursor: 'pointer',
                padding: 6,
                border: `1px solid ${selected.has(s.id) ? '#1677ff' : '#e5e5e5'}`,
                background: selected.has(s.id) ? '#e6f4ff' : '#fff',
                borderRadius: 4,
                fontSize: 11,
              }}
            >
              <Space size={4}>
                <input
                  type="checkbox"
                  checked={selected.has(s.id)}
                  onChange={() => toggleOne(s.id)}
                  onClick={(e) => e.stopPropagation()}
                />
                <Text strong>#{s.slotIndex}</Text>
                <Text>{s.phoneNumber ?? '—'}</Text>
              </Space>
              <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>
                {s.status === 'suspended' ? '未连接' : '连接断开 >10 min'}
              </div>
            </div>
          </Col>
        ))}
      </Row>
    </Card>
  );
}

function EmptySlotMini({
  slot,
  onEnableQR,
  onEnablePairCode,
}: {
  slot: SlotItem;
  onEnableQR: () => void;
  onEnablePairCode: () => void;
}) {
  const menu: MenuProps['items'] = [
    { key: 'qr', label: '📷 扫码绑定', onClick: onEnableQR },
    { key: 'pair', label: '🔗 配对码链接', onClick: onEnablePairCode },
  ];
  return (
    <Dropdown menu={{ items: menu }} trigger={['click']}>
      <Card
        size="small"
        hoverable
        bodyStyle={{ padding: 8, textAlign: 'center' }}
        style={{ cursor: 'pointer', borderStyle: 'dashed', opacity: 0.75 }}
      >
        <WaLogo n={slot.slotIndex} size={28} />
        <div style={{ fontSize: 11, marginTop: 4, color: '#999' }}>空置 ▾</div>
      </Card>
    </Dropdown>
  );
}

function GroupEditorModal({
  mode,
  group,
  allSlots,
  open,
  onClose,
  onSaved,
}: {
  mode: 'new' | 'edit';
  group: GroupSummary | null;
  allSlots: SlotItem[];
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (mode === 'edit' && group) {
      form.setFieldsValue({
        name: group.name,
        description: group.description,
        slotIds: group.slotIds,
      });
    } else {
      form.resetFields();
    }
  }, [mode, group, form, open]);

  const slotOptions = useMemo(
    () =>
      allSlots.map((s) => ({
        value: s.id,
        label: (
          <Space>
            <Text>#{s.slotIndex}</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {s.phoneNumber ?? '空'}
              {s.proxyId !== null && ` · 代理 #${s.proxyId}`}
            </Text>
            <Tag color={STATUS_META[s.status].color} style={{ fontSize: 10 }}>
              {STATUS_META[s.status].label}
            </Tag>
          </Space>
        ),
      })),
    [allSlots],
  );

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (mode === 'new') {
        await api.post('/execution-groups', values);
        message.success('组已创建');
      } else if (group) {
        await api.patch(`/execution-groups/${group.id}`, values);
        message.success('组已更新');
      }
      onSaved();
    } catch (err) {
      if ((err as { errorFields?: unknown }).errorFields) return; // form validation
      message.error(extractErrorMessage(err, '保存失败'));
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
      title={mode === 'new' ? '新建执行组' : `编辑组「${group?.name}」`}
      width={560}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12, fontSize: 12 }}
        message="执行组用于调度时多选槽位 · 不涉及 WA 内部互聊 · 成员可跨组"
      />
      <Form form={form} layout="vertical" size="small">
        <Form.Item
          label="组名"
          name="name"
          rules={[{ required: true, message: '请填组名' }, { max: 64 }]}
        >
          <Input placeholder="如: 引流组 / 客服组 / 养号组" />
        </Form.Item>
        <Form.Item label="描述 (选填)" name="description">
          <Input.TextArea rows={2} maxLength={256} />
        </Form.Item>
        <Form.Item
          label="成员槽位"
          name="slotIds"
          rules={[{ required: true, message: '至少选 1 个槽位' }]}
        >
          <Select
            mode="multiple"
            options={slotOptions}
            optionLabelProp="label"
            placeholder="选择槽位..."
            showSearch
            filterOption={(input, option) =>
              String(option?.value ?? '').includes(input) ||
              (allSlots.find((s) => s.id === option?.value)?.phoneNumber ?? '').includes(input)
            }
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
