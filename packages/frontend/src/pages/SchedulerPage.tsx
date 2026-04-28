// 2026-04-21 · 任务调度 · FAhubX 风格
// KPI 4 统计 · 表格 · 创建任务 Modal (按类型动态字段)
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Progress,
  Radio,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { api, extractErrorMessage } from '@/lib/api';

const { Title, Text } = Typography;
const { TextArea } = Input;

type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'paused' | 'cancelled';

interface TaskItem {
  id: number;
  tenantId: number;
  taskType: string;
  priority: number;
  scheduledAt: string | null;
  targetType: string;
  targetIds: number[];
  status: TaskStatus;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  payload?: {
    roleBaccountId?: number;
    scriptId?: number;
    inviteCode?: string;
    channelName?: string;
    [k: string]: unknown;
  };
}

interface SlotItem {
  id: number;
  accountId: number | null;
  slotIndex: number;
  status: string;
  phoneNumber: string | null;
  waNickname: string | null;
  warmupStage?: number | null;
  proxyId?: number | null;
}

interface GroupSummary {
  id: number;
  name: string;
  slotIds: number[];
  memberCount: number;
}

// 任务类型配置 · 和 backend executors 对应
const TASK_TYPE_CONFIG: Record<string, { label: string; color: string; icon: string; ready: boolean; group?: string; isPlan?: boolean }> = {
  // 📅 计划类 (长周期 · 系统自动排期 · 点了跳养号计划启动向导)
  warmup_plan_14day:   { label: '一键托管 · 14 天 (养号+运营热身)', color: 'orange', icon: '🚀', ready: true, group: '📅 计划类', isPlan: true },
  warmup_plan_7day:    { label: '自动养号 · 7 天',      color: 'orange',   icon: '🌱', ready: true, group: '📅 计划类', isPlan: true },
  mature_operation:    { label: '开启成熟运营 · Day 15+',color: 'green',    icon: '🌿', ready: true, group: '📅 计划类', isPlan: true },
  // 💬 消息类
  script_chat:         { label: '自动聊天 (剧本)',  color: 'blue',     icon: '💬', ready: true, group: '💬 消息类' },
  chat:                { label: '单条消息',         color: 'cyan',     icon: '✉️', ready: true, group: '💬 消息类' },
  auto_reply:          { label: '被动回复 (智能)',  color: 'cyan',     icon: '🤖', ready: true, group: '💬 消息类' },
  // 📢 朋友圈类
  status_post:         { label: '发朋友圈',         color: 'magenta',  icon: '📢', ready: true, group: '📢 朋友圈类' },
  status_browse:       { label: '浏览朋友圈',       color: 'default',  icon: '👁️', ready: true, group: '📢 朋友圈类' },
  status_browse_bulk:  { label: '批量刷 Status',    color: 'geekblue', icon: '🔍', ready: true, group: '📢 朋友圈类' },
  status_react:        { label: '点赞朋友圈',       color: 'gold',     icon: '👍', ready: true, group: '📢 朋友圈类' },
  // 👥 社群扩展
  auto_accept:         { label: '自动接受陌生号',   color: 'green',    icon: '👥', ready: true, group: '👥 社群扩展' },
  add_contact:         { label: '主动加好友',       color: 'green',    icon: '➕', ready: true, group: '👥 社群扩展' },
  join_group:          { label: '自动加群',         color: 'purple',   icon: '🌐', ready: true, group: '👥 社群扩展' },
  follow_channel:      { label: 'Follow 频道',      color: 'volcano',  icon: '📡', ready: true, group: '👥 社群扩展' },
  group_chat:          { label: '群内冒泡',         color: 'purple',   icon: '🗨️', ready: true, group: '👥 社群扩展' },
  // 🎯 运营辅助
  profile_refresh:     { label: '更新资料 (签名)',  color: 'default',  icon: '🖼️', ready: true, group: '🎯 运营辅助' },
  warmup:              { label: '挂机保活 (单次)',  color: 'default',  icon: '💤', ready: true, group: '🎯 运营辅助' },
  // 📤 素材类 (从预置池随机挑)
  send_voice:          { label: '自动发语音 (从池随机)', color: 'geekblue', icon: '🎙', ready: true, group: '📤 素材类' },
  send_image:          { label: '自动发图片 (从池随机)', color: 'geekblue', icon: '🖼', ready: true, group: '📤 素材类' },
  send_video:          { label: '自动发视频 (从池随机)', color: 'geekblue', icon: '🎥', ready: true, group: '📤 素材类' },
};

const STATUS_CONFIG: Record<TaskStatus, { color: string; label: string; icon: string }> = {
  pending:   { color: 'default', label: '待执行',   icon: '⏳' },
  running:   { color: 'processing', label: '运行中', icon: '⚡' },
  done:      { color: 'success', label: '已完成',   icon: '✓' },
  failed:    { color: 'error',   label: '失败',     icon: '✗' },
  paused:    { color: 'warning', label: '已暂停',   icon: '⏸' },
  cancelled: { color: 'default', label: '已取消',   icon: '○' },
};

// 2026-04-26 · R11 · 养号计划 (group_warmup_plan)
interface WarmupPlanItem {
  id: number;
  groupId: number;
  template: string;
  currentDay: number;
  currentPhase: number;
  startedAt: string;
  paused: boolean;
  matureLevel: string | null;
  group?: { name: string };
}

export function SchedulerPage() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [slots, setSlots] = useState<SlotItem[]>([]);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [warmupPlans, setWarmupPlans] = useState<WarmupPlanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [viewChatTask, setViewChatTask] = useState<TaskItem | null>(null);
  const [viewLogsTask, setViewLogsTask] = useState<TaskItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tRes, sRes, gRes, pRes] = await Promise.all([
        api.get<TaskItem[]>('/tasks'),
        api.get<SlotItem[]>('/slots'),
        api.get<GroupSummary[]>('/execution-groups').catch(() => ({ data: [] as GroupSummary[] })),
        // 2026-04-26 · R11 · 加载养号计划 · 任务调度页也要显
        api.get<WarmupPlanItem[]>('/group-warmup').catch(() => ({ data: [] as WarmupPlanItem[] })),
      ]);
      setTasks(tRes.data);
      setSlots(sRes.data);
      setGroups(gRes.data);
      setWarmupPlans(pRes.data);
    } catch (err) {
      setError(extractErrorMessage(err, '加载任务失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // 2026-04-21 · 用户反馈: 任务状态更新慢 · 加 3s 自动轮询
    // 有 running/pending 时才 poll · 全部终态就停
    const iv = setInterval(() => {
      void load();
    }, 3000);
    return () => clearInterval(iv);
  }, [load]);

  const stats = useMemo(() => {
    const s = { total: tasks.length, running: 0, done: 0, failed: 0 };
    tasks.forEach((t) => {
      if (t.status === 'running') s.running++;
      if (t.status === 'done') s.done++;
      if (t.status === 'failed') s.failed++;
    });
    return s;
  }, [tasks]);

  const handleCancel = async (id: number) => {
    try {
      await api.post(`/tasks/${id}/cancel`);
      message.success('任务已取消');
      await load();
    } catch (err) {
      message.error(extractErrorMessage(err, '取消失败'));
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/tasks/${id}`);
      message.success('已删除');
      await load();
    } catch (err) {
      message.error(extractErrorMessage(err, '删除失败'));
    }
  };

  const handleRerun = async (id: number) => {
    try {
      const res = await api.post<TaskItem>(`/tasks/${id}/rerun`);
      message.success(`已重新执行 · 新任务 #${res.data.id}`);
      await load();
    } catch (err) {
      message.error(extractErrorMessage(err, '重跑失败'));
    }
  };

  const columns: ColumnsType<TaskItem> = [
    {
      title: '任务 ID',
      dataIndex: 'id',
      width: 80,
      render: (v: number) => <code style={{ fontSize: 12 }}>#{v}</code>,
    },
    {
      title: '任务类型',
      dataIndex: 'taskType',
      width: 150,
      render: (v: string) => {
        const cfg = TASK_TYPE_CONFIG[v] ?? { label: v, color: 'default', icon: '❓', ready: false };
        return <Tag color={cfg.color}>{cfg.icon} {cfg.label}</Tag>;
      },
    },
    {
      title: '目标',
      dataIndex: 'targetIds',
      width: 280,
      render: (ids: number[], row) => {
        if (row.targetType === 'group') {
          return <Tag color="blue">组任务 · {ids.length} 号</Tag>;
        }
        const findSlotTag = (accId: number) => {
          const s = slots.find((x) => x.accountId === accId);
          return s ? `#${s.slotIndex} · ${s.phoneNumber ?? s.waNickname ?? ''}` : `acc:${accId}`;
        };
        // 自动聊天 · A↔B
        if (row.taskType === 'script_chat' && row.payload?.roleBaccountId) {
          return (
            <Space size={4}>
              <Tag>{findSlotTag(ids[0])}</Tag>
              <span style={{ color: '#1677ff' }}>↔</span>
              <Tag>{findSlotTag(row.payload.roleBaccountId)}</Tag>
            </Space>
          );
        }
        // follow_channel · 显账号 + count/mode 摘要
        if (row.taskType === 'follow_channel') {
          const p = row.payload as { followMode?: string; count?: number; inviteCode?: string; tags?: string[] } | undefined;
          const modeLabel =
            p?.followMode === 'manual'
              ? `📡 手动 · ${p.inviteCode?.slice(0, 8)}...`
              : p?.followMode === 'by-tag'
                ? `📡 按 tag [${(p.tags ?? []).slice(0, 2).join(',')}] × ${p.count ?? '?'}`
                : `📡 随机 × ${p?.count ?? '?'}`;
          return (
            <Space direction="vertical" size={2} style={{ lineHeight: 1.3 }}>
              <Tag>{findSlotTag(ids[0])}</Tag>
              <Text style={{ fontSize: 12 }}>{modeLabel}</Text>
            </Space>
          );
        }
        return (
          <Space size={4} wrap>
            {ids.slice(0, 3).map((id) => (
              <Tag key={id}>{findSlotTag(id)}</Tag>
            ))}
            {ids.length > 3 && <Text type="secondary">+{ids.length - 3}</Text>}
          </Space>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (v: TaskStatus) => {
        const s = STATUS_CONFIG[v] ?? { color: 'default', label: v, icon: '?' };
        return <Tag color={s.color}>{s.icon} {s.label}</Tag>;
      },
    },
    {
      title: '计划时间',
      width: 180,
      render: (_: unknown, row) => {
        if (row.scheduledAt) {
          return (
            <span>
              {new Date(row.scheduledAt).toLocaleString('zh-CN', { hour12: false })}
            </span>
          );
        }
        return (
          <Space size={4}>
            <Tag color="processing">立即</Tag>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {new Date(row.createdAt).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </Text>
          </Space>
        );
      },
    },
    {
      title: '失败原因',
      dataIndex: 'lastError',
      render: (v: string | null) =>
        v ? <Text type="danger" style={{ fontSize: 12 }}>{v.substring(0, 50)}</Text> : '—',
    },
    {
      title: '操作',
      width: 280,
      fixed: 'right',
      render: (_: unknown, row) => {
        const canCancel = row.status === 'pending' || row.status === 'running';
        const canDelete = !canCancel;
        const canRerun = row.status === 'done' || row.status === 'failed' || row.status === 'cancelled';
        return (
          <Space size={4}>
            {canRerun && (
              <Popconfirm
                title="重新执行该任务?"
                description="会创建一个新任务 · 原记录保留"
                onConfirm={() => void handleRerun(row.id)}
              >
                <Button size="small" type="primary">▶ 执行</Button>
              </Popconfirm>
            )}
            <Button size="small" onClick={() => setViewLogsTask(row)}>
              🔍 日志
            </Button>
            {row.taskType === 'script_chat' && (
              <Button size="small" onClick={() => setViewChatTask(row)}>
                💬 聊天
              </Button>
            )}
            {canCancel && (
              <Popconfirm title="取消任务?" onConfirm={() => void handleCancel(row.id)}>
                <Button size="small" danger>取消</Button>
              </Popconfirm>
            )}
            {canDelete && (
              <Popconfirm
                title="永久删除?"
                description="历史记录会被清除"
                okButtonProps={{ danger: true }}
                onConfirm={() => void handleDelete(row.id)}
              >
                <Button size="small" danger icon={<span>🗑</span>} />
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>任务调度</Title>
          <Text type="secondary">管理 WhatsApp 账号的自动化任务 · 10 种类型 · 立即或定时执行</Text>
        </div>
        <Space>
          <Button size="small" onClick={() => void load()} loading={loading}>刷新</Button>
          <Button type="primary" onClick={() => setCreateOpen(true)}>+ 创建任务</Button>
        </Space>
      </div>

      {/* KPI 4 统计卡 · FAhubX 风格 */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="总任务数" value={stats.total} prefix="🕐" valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="运行中" value={stats.running} prefix="⚡" valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="已完成" value={stats.done} prefix="✓" valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="失败" value={stats.failed} prefix="✗" valueStyle={{ color: '#ff4d4f' }} />
          </Card>
        </Col>
      </Row>

      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

      {/* 2026-04-26 · R11 · 养号计划 (group_warmup_plan) · 长周期·跟单条 task 不同 · 单独区块显 */}
      {warmupPlans.length > 0 && (
        <Card size="small" style={{ marginBottom: 12 }} title={
          <Space>
            <span>📅 运行中的养号计划</span>
            <Tag color="orange">{warmupPlans.length} 个</Tag>
          </Space>
        }>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={warmupPlans}
            columns={[
              { title: '计划 ID', dataIndex: 'id', width: 80, render: (id) => <Text strong>#{id}</Text> },
              {
                title: '执行组',
                dataIndex: 'group',
                render: (_: unknown, p: WarmupPlanItem) => {
                  const g = groups.find((x) => x.id === p.groupId);
                  return <Tag color="blue">📁 {g?.name ?? `group #${p.groupId}`} · {g?.memberCount ?? '?'} 号</Tag>;
                },
              },
              {
                title: '模板',
                dataIndex: 'template',
                width: 120,
                render: (t: string) => <Tag>{t === 'v1_7day' ? '7 天养号' : t === 'v1_14day_full' ? '14 天托管' : t}</Tag>,
              },
              {
                title: '进度',
                width: 200,
                render: (_: unknown, p: WarmupPlanItem) => {
                  const total = p.template === 'v1_7day' ? 7 : 14;
                  const pct = Math.min(100, Math.round((p.currentDay / total) * 100));
                  return (
                    <Space direction="vertical" size={0} style={{ width: 180 }}>
                      <Text style={{ fontSize: 12 }}>Day {p.currentDay} / {total} · Phase {p.currentPhase}</Text>
                      <Progress percent={pct} size="small" strokeColor={p.paused ? '#faad14' : '#25d366'} showInfo={false} />
                    </Space>
                  );
                },
              },
              {
                title: '状态',
                width: 100,
                render: (_: unknown, p: WarmupPlanItem) =>
                  p.paused ? <Tag color="orange">⏸ 暂停</Tag>
                  : p.matureLevel ? <Tag color="green">🌿 成熟期 · {p.matureLevel}</Tag>
                  : <Tag color="processing">▶ 跑中</Tag>,
              },
              {
                title: '启动时间',
                dataIndex: 'startedAt',
                width: 160,
                render: (t: string) => <Text type="secondary" style={{ fontSize: 11 }}>{new Date(t).toLocaleString('zh-CN')}</Text>,
              },
              {
                title: '操作',
                width: 220,
                render: (_: unknown, p: WarmupPlanItem) => (
                  <Space size={4}>
                    {p.paused ? (
                      <Button size="small" type="link" onClick={async () => {
                        await api.post(`/group-warmup/${p.id}/resume`).catch(() => {});
                        void load();
                      }}>恢复</Button>
                    ) : (
                      <Button size="small" type="link" onClick={async () => {
                        await api.post(`/group-warmup/${p.id}/pause`).catch(() => {});
                        void load();
                      }}>暂停</Button>
                    )}
                  </Space>
                ),
              },
            ]}
          />
          <div style={{ fontSize: 11, color: '#999', marginTop: 6 }}>
            💡 养号计划是长周期 · 系统按 Day/Phase 自动排子任务到下方任务列. Day 1-2 孵化期默认只挂载 · 不产生子任务. Day 3 后开始排.
          </div>
        </Card>
      )}

      <Card size="small">
        {tasks.length === 0 ? (
          <Empty description="还没有任务 · 点右上 [+ 创建任务]" />
        ) : (
          <Table
            rowKey="id"
            dataSource={tasks}
            columns={columns}
            loading={loading}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            size="small"
            scroll={{ x: 1200 }}
          />
        )}
      </Card>

      <CreateTaskModal
        open={createOpen}
        slots={slots}
        groups={groups}
        onClose={() => setCreateOpen(false)}
        onDone={() => {
          setCreateOpen(false);
          void load();
        }}
      />

      <ViewChatModal
        task={viewChatTask}
        slots={slots}
        onClose={() => setViewChatTask(null)}
      />

      <ViewLogsModal
        task={viewLogsTask}
        onClose={() => setViewLogsTask(null)}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 执行日志 Modal · 所有任务类型通用
// ════════════════════════════════════════════════════════════════════

interface TaskRunLog {
  runId: number;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  logs: Array<{ at: string; step: string; ok: boolean; meta?: Record<string, unknown> }>;
}

// step name → 中文 emoji 描述
const STEP_FRIENDLY: Record<string, { emoji: string; text: string }> = {
  // script_chat
  'script-start':           { emoji: '📖', text: '剧本开始' },
  'script-done':            { emoji: '✅', text: '剧本完成' },
  'chat-prepared':          { emoji: '✉️', text: '消息已准备' },
  'chat-sent':              { emoji: '📤', text: '消息已发送' },
  'turn-started':           { emoji: '🔄', text: '轮次开始' },
  'turn-done':              { emoji: '✓',  text: '轮次完成' },
  'typing':                 { emoji: '⌨️', text: '输入中' },
  'rewrite-cache-hit':      { emoji: '💡', text: 'AI 改写 cache 命中' },
  'rewrite-new':            { emoji: '🤖', text: 'AI 生成新文本' },
  'ai-fallback':            { emoji: '⚠',  text: 'AI 降级到原文' },
  // follow_channel
  'channel-resolved':       { emoji: '🔍', text: '频道元数据已拉取' },
  'channel-followed':       { emoji: '📡', text: '频道 follow 成功' },
  'channel-disabled':       { emoji: '⛔', text: '死 code 自动禁用' },
  'trying-replacement':     { emoji: '🔄', text: '换一条重试' },
  followed:                 { emoji: '✅', text: '已关注频道' },
  failed:                   { emoji: '❌', text: '关注失败' },
  'follow-attempt':         { emoji: '⚡', text: '尝试关注' },
  // status
  'status-posted':          { emoji: '📢', text: '状态已发布' },
  'status-react-planned':   { emoji: '👍', text: '点赞计划' },
  'status-browse-bulk-planned': { emoji: '👁', text: '批量浏览状态' },
  // auto_accept
  'auto-accept-planned':    { emoji: '👥', text: '自动接受好友' },
  'phase-cap-zero':         { emoji: '🚫', text: 'Phase 禁止接受' },
  // takeover
  'pair-skip':              { emoji: '⏸', text: '无可配对账号' },
  'pair-picked':            { emoji: '🎲', text: '已挑选配对账号' },
};

function ViewLogsModal({
  task,
  onClose,
}: {
  task: TaskItem | null;
  onClose: () => void;
}) {
  const [runs, setRuns] = useState<TaskRunLog[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!task) return;
    setLoading(true);
    try {
      const res = await api.get<TaskRunLog[]>(`/tasks/${task.id}/logs`);
      setRuns(res.data);
    } finally {
      setLoading(false);
    }
  }, [task]);

  useEffect(() => {
    if (!task) return;
    void load();
    if (task.status === 'running' || task.status === 'pending') {
      const iv = setInterval(() => void load(), 3000);
      return () => clearInterval(iv);
    }
  }, [task, load]);

  if (!task) return null;

  const renderLogLine = (l: { at: string; step: string; ok: boolean; meta?: Record<string, unknown> }) => {
    const friendly = STEP_FRIENDLY[l.step];
    const emoji = friendly?.emoji ?? (l.ok ? '•' : '✗');
    const text = friendly?.text ?? l.step;
    const time = new Date(l.at).toLocaleTimeString('zh-CN', { hour12: false });
    const meta = l.meta ? Object.entries(l.meta).filter(([k]) => !k.startsWith('_')).slice(0, 3) : [];
    return (
      <div key={l.at + l.step} style={{ marginBottom: 4, fontSize: 13, fontFamily: 'monospace' }}>
        <span style={{ color: '#888' }}>[{time}]</span>{' '}
        <span style={{ marginRight: 4 }}>{emoji}</span>
        <span style={{ color: l.ok ? '#e8e8e8' : '#ff6b6b' }}>{text}</span>
        {meta.length > 0 && (
          <span style={{ color: '#888', marginLeft: 8, fontSize: 11 }}>
            {meta.map(([k, v]) => `${k}=${String(v).substring(0, 40)}`).join(' · ')}
          </span>
        )}
      </div>
    );
  };

  return (
    <Modal
      open={!!task}
      onCancel={onClose}
      title={`📜 执行日志 · 任务 #${task.id} · ${task.status === 'done' ? '✓ 已完成' : task.status === 'failed' ? '✗ 失败' : task.status}`}
      width={720}
      footer={
        <Space>
          <Button size="small" onClick={() => void load()} loading={loading}>刷新</Button>
          <Button onClick={onClose}>关闭</Button>
        </Space>
      }
    >
      {runs.length === 0 ? (
        <Empty description={loading ? '加载中...' : '还没有执行记录'} />
      ) : (
        runs.map((run, idx) => (
          <Card
            key={run.runId}
            size="small"
            style={{ marginBottom: 12 }}
            title={
              <Space>
                <Tag color={run.status === 'success' ? 'success' : run.status === 'failed' ? 'error' : 'processing'}>
                  运行 {runs.length - idx} · {run.status}
                </Tag>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {new Date(run.startedAt).toLocaleString('zh-CN', { hour12: false })}
                  {run.finishedAt && ` → ${new Date(run.finishedAt).toLocaleTimeString('zh-CN', { hour12: false })}`}
                </Text>
              </Space>
            }
          >
            {run.errorMessage && (
              <Alert
                type={run.status === 'success' ? 'success' : 'error'}
                showIcon
                message={run.errorMessage}
                style={{ marginBottom: 8, fontSize: 12 }}
              />
            )}
            <div
              style={{
                background: '#1f1f1f',
                color: '#e8e8e8',
                padding: 12,
                borderRadius: 4,
                maxHeight: 360,
                overflowY: 'auto',
              }}
            >
              {run.logs.length === 0 ? (
                <Text type="secondary" style={{ color: '#888' }}>(无日志)</Text>
              ) : (
                run.logs.map(renderLogLine)
              )}
            </div>
          </Card>
        ))
      )}
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════
// 查看聊天 Modal · 实时刷新
// ════════════════════════════════════════════════════════════════════

interface ChatMsg {
  accountId: number;
  direction: string;
  content: string | null;
  sentAt: string;
}

function ViewChatModal({
  task,
  slots,
  onClose,
}: {
  task: TaskItem | null;
  slots: SlotItem[];
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [loading, setLoading] = useState(false);

  const p = (task?.payload ?? {}) as { roleAaccountId?: number; roleBaccountId?: number };
  const slotA = slots.find((s) => s.accountId === p.roleAaccountId);
  const slotB = slots.find((s) => s.accountId === p.roleBaccountId);

  const load = useCallback(async () => {
    if (!task) return;
    setLoading(true);
    try {
      const res = await api.get<ChatMsg[]>(`/tasks/${task.id}/chat`);
      setMessages(res.data);
    } finally {
      setLoading(false);
    }
  }, [task]);

  useEffect(() => {
    if (!task) return;
    void load();
    // 运行中任务自动 3s 刷新
    if (task.status === 'running' || task.status === 'pending') {
      const iv = setInterval(() => void load(), 3000);
      return () => clearInterval(iv);
    }
  }, [task, load]);

  // 按 account + out 方向 过滤 · 只显 A 和 B 的发送侧 (防 in/out 重复)
  const filtered = useMemo(
    () => messages.filter((m) => m.direction === 'out'),
    [messages],
  );

  return (
    <Modal
      open={!!task}
      onCancel={onClose}
      title={task ? `💬 任务 #${task.id} · 聊天内容 (${filtered.length} 条消息)` : ''}
      width={640}
      footer={
        <Space>
          <Button size="small" onClick={() => void load()} loading={loading}>刷新</Button>
          <Button onClick={onClose}>关闭</Button>
        </Space>
      }
    >
      {task?.status === 'running' && (
        <Alert type="info" showIcon message="任务运行中 · 每 3 秒自动刷新" style={{ marginBottom: 12 }} />
      )}
      {task?.status === 'failed' && task.lastError && (
        <Alert type="error" showIcon message={task.lastError} style={{ marginBottom: 12 }} />
      )}
      <div style={{ maxHeight: 480, overflowY: 'auto', padding: 8, background: '#f5f5f5', borderRadius: 4 }}>
        {filtered.length === 0 ? (
          <Empty description="暂无消息" />
        ) : (
          filtered.map((m, idx) => {
            const isA = m.accountId === slotA?.accountId;
            return (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  justifyContent: isA ? 'flex-start' : 'flex-end',
                  marginBottom: 8,
                }}
              >
                <div style={{ maxWidth: '70%' }}>
                  <div style={{ fontSize: 11, color: '#999', marginBottom: 2, textAlign: isA ? 'left' : 'right' }}>
                    {isA ? `👤 A · #${slotA?.slotIndex}` : `👤 B · #${slotB?.slotIndex}`}
                    {'  '}{new Date(m.sentAt).toLocaleTimeString('zh-CN', { hour12: false })}
                  </div>
                  <div
                    style={{
                      padding: '8px 12px',
                      background: isA ? '#fff' : '#dcf8c6',
                      borderRadius: 8,
                      border: '1px solid #e5e5e5',
                      wordBreak: 'break-word',
                    }}
                  >
                    {m.content ?? <Text type="secondary">[无文字]</Text>}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════
// 创建任务 Modal · 按类型动态字段
// ════════════════════════════════════════════════════════════════════

function CreateTaskModal({
  open,
  slots,
  groups,
  onClose,
  onDone,
}: {
  open: boolean;
  slots: SlotItem[];
  groups: GroupSummary[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [taskType, setTaskType] = useState<string | null>(null);

  const activeSlots = useMemo(() => slots.filter((s) => s.status !== 'empty'), [slots]);

  const slotOptions = activeSlots.map((s) => ({
    value: s.id,
    label: `#${s.slotIndex} · ${s.phoneNumber ?? s.waNickname ?? '未命名'}`,
  }));

  const groupOptions = groups.map((g) => ({
    value: g.id,
    label: `📁 ${g.name} · ${g.memberCount} 号`,
  }));

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);

      // ── 特殊分支: 自动聊天 (script_chat) · A↔B 双号, 1 个 task (不批量) ──
      if (taskType === 'script_chat') {
        if (!values.roleAaccountId || !values.roleBaccountId) {
          message.warning('请选 A / B 两个账号');
          setSubmitting(false);
          return;
        }
        if (values.roleAaccountId === values.roleBaccountId) {
          message.warning('A 和 B 不能是同一个账号');
          setSubmitting(false);
          return;
        }
        if (!values.scriptId) {
          message.warning('请选择剧本');
          setSubmitting(false);
          return;
        }
        const slotA = slots.find((s) => s.id === values.roleAaccountId);
        const slotB = slots.find((s) => s.id === values.roleBaccountId);

        // 2026-04-21 · 软预检: warmup_stage 不足 + 同 IP · 警告不阻拦
        const warnings: string[] = [];
        // warmup stage
        const selectedScript = (window as unknown as { __pickedScript?: ScriptItem }).__pickedScript;
        // 通过脚本 DB 拉 minWarmupStage (scripts state 在 ScriptChatFields 里, 这里不方便取)
        // 简化: 直接用 form 存的 · 在 ScriptChatFields 里 window.__pickedScript 记录
        const minStage = selectedScript?.minWarmupStage ?? 0;
        const stageA = slotA?.warmupStage ?? 0;
        const stageB = slotB?.warmupStage ?? 0;
        if (minStage > 0 && (stageA < minStage || stageB < minStage)) {
          warnings.push(
            `⚠ warmup stage 不足: 剧本要求 ≥ ${minStage} · A=${stageA} B=${stageB}`,
          );
        }
        // 同 IP (proxy_id) · null 表示直连本机 IP · 两边都 null = 也同 IP
        const pA = slotA?.proxyId ?? null;
        const pB = slotB?.proxyId ?? null;
        if (pA === pB) {
          warnings.push(
            pA === null
              ? `⚠ A 和 B 都走本机直连 (未配代理) · 同 IP · 可能触发 WA 关联风控`
              : `⚠ A 和 B 共用同一代理 (proxy_id=${pA}) · 可能触发 WA 关联风控`,
          );
        }

        let forceOverride = false;
        if (warnings.length > 0) {
          setSubmitting(false);
          await new Promise<void>((resolve) => {
            Modal.confirm({
              title: '⚠ 执行前的软提示 · 不阻拦, 但建议注意',
              width: 520,
              content: (
                <div>
                  <ul style={{ paddingLeft: 16, marginBottom: 12 }}>
                    {warnings.map((w, i) => (
                      <li key={i} style={{ fontSize: 13, marginBottom: 6 }}>{w}</li>
                    ))}
                  </ul>
                  <div style={{ fontSize: 12, color: '#666' }}>
                    点"强制执行"继续 · 系统会记审计日志 · 点"取消"回去调整.
                  </div>
                </div>
              ),
              okText: '强制执行',
              okButtonProps: { danger: true },
              cancelText: '取消',
              onOk: () => {
                forceOverride = true;
                resolve();
              },
              onCancel: () => resolve(),
            });
          });
          if (!forceOverride) return;
          setSubmitting(true);
        }

        await api.post('/tasks', {
          taskType: 'script_chat',
          priority: values.priority ?? 5,
          targetType: 'account',
          targetIds: [slotA!.accountId],
          scheduledAt: values.scheduledAt ? new Date(values.scheduledAt).toISOString() : null,
          payload: {
            scriptId: values.scriptId,
            roleAaccountId: slotA?.accountId,
            roleBaccountId: slotB?.accountId,
            aiRewrite: !!values.aiEnabled,
            fastMode: !!values.fastMode,
            forceOverride,
            repeat: values.repeatCycle && values.repeatCycle !== 'once' ? values.repeatCycle : undefined,
          },
        });
        message.success(forceOverride ? `⚠ 任务已创建 (强制执行模式)` : `自动聊天任务已创建`);
        form.resetFields();
        setTaskType(null);
        onDone();
        return;
      }

      // ── 通用分支: 按 slotSource 展开 targetIds ──
      let targetIds: number[] = [];
      if (values.slotSource === 'group') {
        const g = groups.find((x) => x.id === values.slotGroupId);
        targetIds = g?.slotIds ?? [];
      } else {
        targetIds = values.slotIds ?? [];
      }
      if (targetIds.length === 0) {
        message.warning('请至少选一个槽位');
        setSubmitting(false);
        return;
      }

      // ── follow_channel · 1 任务 follow N 频道 · 后端循环 ──
      if (taskType === 'follow_channel') {
        const firstSlotDbId = targetIds[0];
        const slotObj = slots.find((s) => s.id === firstSlotDbId);
        if (!slotObj || !slotObj.accountId) {
          message.warning(`槽位 #${firstSlotDbId} 未绑账号 · 无法 follow`);
          setSubmitting(false);
          return;
        }
        const accountId = slotObj.accountId;

        const payload: Record<string, unknown> = {
          followMode: values.followMode,
          intervalMinSec: values.intervalMinSec ?? 30,
          intervalMaxSec: values.intervalMaxSec ?? 180,
          maxDaily: values.maxDaily ?? 5,
        };
        if (values.followMode === 'manual') {
          payload.inviteCode = values.inviteCode;
        } else {
          payload.count = values.count ?? 5;
          if (values.followMode === 'by-tag') payload.tags = values.selectedTags;
        }

        await api.post('/tasks', {
          taskType: 'follow_channel',
          priority: values.priority ?? 5,
          targetType: 'account',
          targetIds: [accountId],
          scheduledAt: values.scheduledAt ? new Date(values.scheduledAt).toISOString() : null,
          payload,
        });
        message.success(
          values.followMode === 'manual'
            ? `任务已创建 · follow 1 个频道${targetIds.length > 1 ? ' · 多槽位只用首个' : ''}`
            : `任务已创建 · 将 follow 最多 ${values.count ?? 5} 个频道${targetIds.length > 1 ? ' · 多槽位只用首个' : ''}`,
        );
        form.resetFields();
        setTaskType(null);
        onDone();
        return;
      }

      const payload = buildPayload(values);

      // 2026-04-22 · fix: targetIds 必须是 account.id (dispatcher 约定), 不是 slot.id
      // targetIds 从 UI 来的是 slot.id · 反查 account_id
      const accountIds: number[] = [];
      for (const sid of targetIds) {
        const slot = slots.find((s) => s.id === sid);
        if (!slot || !slot.accountId) {
          message.warning(`槽位 #${sid} 未绑账号 · 已跳过`);
          continue;
        }
        accountIds.push(slot.accountId);
      }
      if (accountIds.length === 0) {
        message.warning('所有选中槽位都没绑账号 · 无法创建');
        setSubmitting(false);
        return;
      }

      const promises = accountIds.map((accId) =>
        api.post('/tasks', {
          taskType: taskType,
          priority: values.priority ?? 5,
          targetType: 'account',
          targetIds: [accId],
          scheduledAt: values.scheduledAt ? new Date(values.scheduledAt).toISOString() : null,
          payload,
        }),
      );
      await Promise.all(promises);
      message.success(`已创建 ${accountIds.length} 个任务`);
      form.resetFields();
      setTaskType(null);
      onDone();
    } catch (err: unknown) {
      if ((err as { errorFields?: unknown }).errorFields) return;
      message.error(extractErrorMessage(err, '创建失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    setTaskType(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onCancel={handleCancel}
      title="+ 创建自动化任务"
      width={720}
      footer={(() => {
        // 2026-04-26 · plan 类任务用 modal 内的"启动计划"按钮 · footer "创建任务" 隐藏避免双按钮误导
        const isPlanType = taskType ? TASK_TYPE_CONFIG[taskType]?.isPlan === true : false;
        return [
          <Button key="c" onClick={handleCancel}>取消</Button>,
          !isPlanType && (
            <Button
              key="s"
              type="primary"
              loading={submitting}
              disabled={!taskType}
              onClick={handleSubmit}
            >
              创建任务
            </Button>
          ),
        ].filter(Boolean);
      })()}
      destroyOnClose
    >
      <Form form={form} layout="vertical" requiredMark={false} initialValues={{ slotSource: 'manual', priority: 5 }}>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item label="任务名称" name="name" rules={[{ max: 64 }]}>
              <Input placeholder="例如: 产品推广对话任务" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="任务类型" required>
              <Select
                placeholder="选择类型"
                value={taskType}
                onChange={(v) => setTaskType(v)}
                options={Object.entries(TASK_TYPE_CONFIG).map(([k, v]) => ({
                  value: k,
                  disabled: !v.ready,
                  label: (
                    <Space>
                      <span>{v.icon}</span>
                      <span>{v.label}</span>
                      {!v.ready && <Tag color="orange" style={{ marginLeft: 4, fontSize: 10 }}>开发中</Tag>}
                    </Space>
                  ),
                }))}
              />
            </Form.Item>
          </Col>
        </Row>

        {!taskType ? (
          <div style={{ textAlign: 'center', padding: 48, color: '#999' }}>
            💬 请先选择任务类型
          </div>
        ) : taskType === 'warmup_plan_7day' || taskType === 'warmup_plan_14day' ? (
          // ═══ 计划类 · 不走普通任务创建 · 引导到群养号启动向导 ═══
          <WarmupPlanRedirect template={taskType === 'warmup_plan_14day' ? 'v1_14day_full' : 'v1_7day'} />
        ) : taskType === 'mature_operation' ? (
          // ═══ 成熟运营期 · 选已完成 14 天托管的 plan · 选档位 ═══
          <MatureOperationRedirect />
        ) : taskType === 'script_chat' ? (
          // ═══ 自动聊天 (FAhubX 式) · A↔B + 剧本 + AI + 执行计划 ═══
          <ScriptChatFields activeSlots={activeSlots} />
        ) : (
          <>
            {/* 通用: 槽位选择 */}
            <Form.Item label="槽位来源" name="slotSource">
              <Select
                options={[
                  { value: 'manual', label: '手动选槽位' },
                  { value: 'group', label: '按执行组' },
                ]}
              />
            </Form.Item>
            <Form.Item
              noStyle
              shouldUpdate={(prev, cur) => prev.slotSource !== cur.slotSource}
            >
              {({ getFieldValue }) =>
                getFieldValue('slotSource') === 'group' ? (
                  <Form.Item
                    label="选择执行组"
                    name="slotGroupId"
                    rules={[{ required: true, message: '请选组' }]}
                  >
                    <Select placeholder="选组..." options={groupOptions} />
                  </Form.Item>
                ) : (
                  <Form.Item
                    label="选择槽位 (多选)"
                    name="slotIds"
                    rules={[{ required: true, message: '至少选一个槽位' }]}
                  >
                    <Select mode="multiple" placeholder="选一个或多个..." options={slotOptions} />
                  </Form.Item>
                )
              }
            </Form.Item>

            <TaskTypeFields taskType={taskType} />

            <Row gutter={12}>
              <Col span={12}>
                <Form.Item label="优先级 (1-10)" name="priority" extra="数字小=优先级高">
                  <InputNumber min={1} max={10} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  label="计划时间 (留空=立即)"
                  name="scheduledAt"
                  extra="ISO 格式或 datetime · 例如 2026-04-25T09:00"
                >
                  <Input type="datetime-local" />
                </Form.Item>
              </Col>
            </Row>
          </>
        )}
      </Form>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════════
// 按类型的特定字段
// ════════════════════════════════════════════════════════════════════

function TaskTypeFields({ taskType }: { taskType: string }) {
  if (taskType === 'chat') {
    return (
      <>
        <Form.Item label="接收方 JID / 手机号" name="to" rules={[{ required: true }]}>
          <Input placeholder="60xxxxxxxxx 或 xxx@s.whatsapp.net" />
        </Form.Item>
        <Form.Item label="消息类型" name="contentType" initialValue="text" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'text', label: '💬 文本' },
              { value: 'image', label: '🖼️ 图片' },
              { value: 'video', label: '🎥 视频' },
              { value: 'voice', label: '🎙️ 语音' },
              { value: 'file', label: '📎 文件' },
            ]}
          />
        </Form.Item>
        <Form.Item label="消息内容 (文本或 caption)" name="text">
          <TextArea rows={3} placeholder="输入文字..." />
        </Form.Item>
        <Form.Item label="媒体文件 (Base64, 选填 · 开发中)" name="mediaBase64">
          <TextArea rows={2} placeholder="base64 字符串 · 后续支持上传" />
        </Form.Item>
      </>
    );
  }
  if (taskType === 'status_post') {
    return <StatusPostFields />;
  }
  // script_chat 走独立 ScriptChatFields · 此处不会触达
  if (taskType === 'script_chat') return null;
  if (taskType === 'send_voice') return <SendMediaFields kind="voice" />;
  if (taskType === 'send_image') return <SendMediaFields kind="image" />;
  if (taskType === 'send_video') return <SendMediaFields kind="video" />;
  if (taskType === 'join_group') {
    return (
      <>
        <Form.Item
          label="群邀请链接 Code"
          name="inviteCode"
          rules={[{ required: true }]}
          extra="chat.whatsapp.com/XXXXXXX 的最后一段"
        >
          <Input placeholder="例如: AbCdEf12345XYZ" />
        </Form.Item>
        <Row gutter={8}>
          <Col span={8}>
            <Form.Item label="每日上限 (群)" name="maxDaily" initialValue={5}>
              <InputNumber min={1} max={20} style={{ width: '100%' }} addonAfter="群/天" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="最短间隔 (秒)" name="intervalMinSec" initialValue={900}>
              <InputNumber min={60} max={7200} style={{ width: '100%' }} addonAfter="秒" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="最长间隔 (秒)" name="intervalMaxSec" initialValue={3600}>
              <InputNumber min={60} max={7200} style={{ width: '100%' }} addonAfter="秒" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item label="加入后自动发欢迎 (选填)" name="postJoinSendText" extra="加群 >60s 后才发 · 防识别">
          <TextArea rows={2} placeholder="大家好 · 很高兴加入..." />
        </Form.Item>
        <Alert
          type="warning"
          showIcon
          style={{ fontSize: 12 }}
          message="⚠ 加群风控最严 · 建议 ≤5 群/天 · 间隔 15-60 分钟 · 超量极可能封号"
        />
      </>
    );
  }
  if (taskType === 'follow_channel') {
    return <FollowChannelFields />;
  }
  if (taskType === 'warmup') {
    return (
      <Alert
        type="info"
        showIcon
        message="养号任务由系统按 §B.2 日历自动排程 · 手动创建仅用于补单/测试"
      />
    );
  }
  if (taskType === 'status_browse') {
    return (
      <>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12, fontSize: 12 }}
          message="浏览朋友圈 · 养号用 (§B.2 Day 4 'reactive 看 1-2 条')"
        />
        <Row gutter={8}>
          <Col span={12}>
            <Form.Item label="浏览时长 (分钟)" name="durationMinutes" initialValue={20}>
              <InputNumber min={5} max={60} style={{ width: '100%' }} addonAfter="分钟" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label="每条停留 (秒)" name="perItemDwellSec" initialValue={10}>
              <InputNumber min={3} max={30} style={{ width: '100%' }} addonAfter="秒" />
            </Form.Item>
          </Col>
        </Row>
      </>
    );
  }
  if (taskType === 'status_browse_bulk') {
    return (
      <>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12, fontSize: 12 }}
          message="批量刷 Status · 看完所有好友的 Status · 对方会看到"
        />
        <Row gutter={8}>
          <Col span={8}>
            <Form.Item label="浏览时长 (分钟)" name="durationMinutes" initialValue={30}>
              <InputNumber min={5} max={120} style={{ width: '100%' }} addonAfter="分钟" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="最多浏览条数" name="maxItems" initialValue={50}>
              <InputNumber min={5} max={200} style={{ width: '100%' }} addonAfter="条" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="每条停留 (秒)" name="perItemDwellSec" initialValue={5}>
              <InputNumber min={2} max={30} style={{ width: '100%' }} addonAfter="秒" />
            </Form.Item>
          </Col>
        </Row>
      </>
    );
  }
  if (taskType === 'status_react') {
    return (
      <>
        <Form.Item label="每天点赞上限" name="maxPerDay" initialValue={3}>
          <InputNumber min={1} max={5} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="Emoji" name="emoji" initialValue="👍">
          <Select options={[
            { value: '👍', label: '👍' },
            { value: '❤️', label: '❤️' },
            { value: '😂', label: '😂' },
            { value: '🎉', label: '🎉' },
          ]} />
        </Form.Item>
      </>
    );
  }
  if (taskType === 'auto_accept') {
    return (
      <>
        <Form.Item label="每日上限" name="maxDaily" initialValue={10}>
          <InputNumber min={1} max={100} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="接受后发欢迎文本 (选填)" name="postAcceptSendText">
          <TextArea rows={2} placeholder="你好 · 欢迎加我..." />
        </Form.Item>
      </>
    );
  }
  return <Text type="secondary">此类型暂无额外配置</Text>;
}

// ════════════════════════════════════════════════════════════════════
// 自动聊天 (script_chat) · FAhubX 式 fields
// ════════════════════════════════════════════════════════════════════

interface ScriptItem {
  id: number;
  scriptId: string;
  name: string;
  category: string;
  totalTurns: number;
  packId: number;
  minWarmupStage: number;
  aiRewrite: boolean;
}

function ScriptChatFields({ activeSlots }: { activeSlots: SlotItem[] }) {
  const [scripts, setScripts] = useState<ScriptItem[]>([]);
  const [loadingScripts, setLoadingScripts] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [roleA, setRoleA] = useState<number | null>(null);

  // A 账号当前 warmup stage (用于剧本过滤)
  const currentStage = useMemo(() => {
    const slot = activeSlots.find((s) => s.id === roleA);
    return slot?.warmupStage ?? 0;
  }, [activeSlots, roleA]);

  // 拉所有剧本包 · 聚合 scripts
  useEffect(() => {
    const loadAll = async () => {
      setLoadingScripts(true);
      try {
        const packs = (await api.get<Array<{ id: number }>>('/script-packs')).data;
        const lists = await Promise.all(
          packs.map((p) => api.get<ScriptItem[]>(`/script-packs/${p.id}/scripts`).then((r) => r.data)),
        );
        setScripts(lists.flat());
      } catch (err) {
        message.error(extractErrorMessage(err, '加载剧本失败'));
      } finally {
        setLoadingScripts(false);
      }
    };
    void loadAll();
  }, []);

  const categories = useMemo(() => {
    const s = new Set<string>();
    scripts.forEach((x) => s.add(x.category));
    return Array.from(s);
  }, [scripts]);

  const filtered = useMemo(() => {
    return scripts.filter((s) => {
      if (categoryFilter !== 'all' && s.category !== categoryFilter) return false;
      if (searchText && !s.name.includes(searchText)) return false;
      return true;
    });
  }, [scripts, categoryFilter, searchText]);

  const accountOptions = activeSlots.map((s) => ({
    value: s.id,
    label: (
      <Space>
        <Tag>#{s.slotIndex}</Tag>
        <span>{s.phoneNumber ?? s.waNickname ?? '未命名'}</span>
      </Space>
    ),
  }));

  return (
    <>
      {/* 聊天账号设置 · A ↔ B */}
      <div style={{ borderLeft: '3px solid #1677ff', paddingLeft: 12, marginBottom: 16 }}>
        <Text strong style={{ color: '#1677ff' }}>💬 聊天账号设置 (A ↔ B 角色扮演)</Text>
      </div>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item label="👤 账号 A (发起方)" name="roleAaccountId" rules={[{ required: true, message: '请选 A' }]}>
            <Select
              placeholder="选择扮演 A 角色的账号"
              options={accountOptions}
              optionLabelProp="label"
              onChange={(v) => setRoleA(v)}
            />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item label="👤 账号 B (回应方)" name="roleBaccountId" rules={[{ required: true, message: '请选 B' }]}>
            <Select placeholder="选择扮演 B 角色的账号" options={accountOptions} optionLabelProp="label" />
          </Form.Item>
        </Col>
      </Row>

      {/* 剧本选择 */}
      <div style={{ borderLeft: '3px solid #1677ff', paddingLeft: 12, margin: '16px 0 8px' }}>
        <Text strong style={{ color: '#1677ff' }}>💬 选择聊天剧本 (共 {scripts.length} 个)</Text>
      </div>
      <Space style={{ marginBottom: 8, width: '100%' }}>
        <Input
          placeholder="🔍 搜索剧本..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{ width: 200 }}
          allowClear
        />
        <Select
          value={categoryFilter}
          onChange={setCategoryFilter}
          style={{ width: 120 }}
          options={[
            { value: 'all', label: '全部' },
            ...categories.map((c) => ({ value: c, label: c })),
          ]}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>共 {filtered.length} 个</Text>
      </Space>
      <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
        💡 A 账号当前 stage = <strong>{currentStage}</strong> · 红色剧本为需要更高 stage (先养号升阶)
      </div>
      <Form.Item
        name="scriptId"
        rules={[{ required: true, message: '请选一个剧本' }]}
        shouldUpdate
      >
        <ScriptListPicker
          scripts={filtered}
          loading={loadingScripts}
          currentStage={currentStage}
          onPick={(s) => {
            // 记到 window 给 submit 预检用 (避免复杂提升 state)
            (window as unknown as { __pickedScript?: ScriptItem }).__pickedScript = s;
          }}
        />
      </Form.Item>

      {/* AI 辅助 */}
      <div style={{ borderLeft: '3px solid #722ed1', paddingLeft: 12, margin: '16px 0 8px' }}>
        <Text strong style={{ color: '#722ed1' }}>✨ AI 辅助优化</Text>
      </div>
      <Form.Item name="aiEnabled" valuePropName="checked" extra="启用后每条消息走 M6 rewrite · 不同轮次生成不同文案 · 更像真人">
        <input type="checkbox" style={{ marginRight: 8 }} /> 启用 AI 优化对话内容
      </Form.Item>

      {/* 极速模式 · dev 测试 */}
      <Form.Item
        name="fastMode"
        valuePropName="checked"
        extra="⚠ 跳过所有发消息/打字延迟 · 仅用于测试 · 生产强烈不推荐 (WA 反检测识别机器人)"
      >
        <input type="checkbox" style={{ marginRight: 8 }} /> ⚡ 极速模式 (测试用 · 无延迟)
      </Form.Item>

      {/* 执行计划 */}
      <div style={{ borderLeft: '3px solid #faad14', paddingLeft: 12, margin: '16px 0 8px' }}>
        <Text strong style={{ color: '#faad14' }}>⏰ 执行计划</Text>
      </div>
      <Row gutter={12}>
        <Col span={12}>
          <Form.Item label="执行时间 (留空=立即)" name="scheduledAt">
            <Input type="datetime-local" />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item label="重复周期" name="repeatCycle" initialValue="once">
            <Select
              options={[
                { value: 'once', label: '单次执行' },
                { value: 'daily', label: '每天一次' },
                { value: 'weekly', label: '每周一次' },
                { value: 'monthly', label: '每月一次' },
              ]}
            />
          </Form.Item>
        </Col>
      </Row>
      <Form.Item name="priority" initialValue={5} hidden><InputNumber /></Form.Item>
    </>
  );
}

function ScriptListPicker({
  scripts,
  loading,
  currentStage,
  value,
  onChange,
  onPick,
}: {
  scripts: ScriptItem[];
  loading: boolean;
  currentStage: number;
  value?: number;
  onChange?: (v: number) => void;
  onPick?: (s: ScriptItem) => void;
}) {
  if (loading) {
    return <div style={{ textAlign: 'center', padding: 24, color: '#999' }}>加载剧本中...</div>;
  }
  if (scripts.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 24, background: '#fafafa', borderRadius: 4 }}>
        <Text type="secondary">没有剧本 · 请先去"设置 → 素材库 → 剧本包"导入</Text>
      </div>
    );
  }
  return (
    <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #d9d9d9', borderRadius: 4 }}>
      {scripts.map((s) => {
        const meetsStage = (s.minWarmupStage ?? 0) <= currentStage;
        return (
          <div
            key={s.id}
            onClick={() => {
              onChange?.(s.id);
              onPick?.(s);
            }}
            style={{
              padding: 12,
              borderBottom: '1px solid #f0f0f0',
              cursor: 'pointer',
              background: value === s.id ? '#e6f4ff' : '#fff',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>
                {s.name}
                {!meetsStage && <Tag color="orange" style={{ marginLeft: 8, fontSize: 10 }}>⚠ 需强制</Tag>}
              </div>
              <div style={{ fontSize: 12, color: '#666' }}>{s.scriptId}</div>
            </div>
            <Space>
              <Tag color="blue">{s.category}</Tag>
              <Tag color={meetsStage ? 'green' : 'orange'}>
                需 stage ≥ {s.minWarmupStage ?? 0}
              </Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>{s.totalTurns} 轮</Text>
            </Space>
          </div>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Status Post · 发朋友圈 · 内容来源 4 模式
// ════════════════════════════════════════════════════════════════════

function StatusPostFields() {
  const [contentSource, setContentSource] = useState<'random' | 'by-tag' | 'ai' | 'manual'>('random');

  return (
    <>
      <Form.Item label="Status 类型" name="contentType" initialValue="text" rules={[{ required: true }]}>
        <Select
          options={[
            { value: 'text', label: '💬 纯文本' },
            { value: 'image', label: '🖼️ 图文' },
            { value: 'video', label: '🎥 视频' },
            { value: 'voice', label: '🎙️ 语音' },
          ]}
        />
      </Form.Item>

      <Form.Item label="内容来源" name="contentSource" initialValue="random">
        <Radio.Group
          value={contentSource}
          onChange={(e) => setContentSource(e.target.value)}
          buttonStyle="solid"
        >
          <Radio.Button value="random">🎲 种子库随机</Radio.Button>
          <Radio.Button value="by-tag">🏷 按 Tag 挑</Radio.Button>
          <Radio.Button value="ai">🤖 AI 生成</Radio.Button>
          <Radio.Button value="manual">✍ 手动输入</Radio.Button>
        </Radio.Group>
      </Form.Item>

      {contentSource === 'random' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12, fontSize: 12 }}
          message="⚠ 文案种子库 V1.1 即将上线"
          description="当前无种子数据 · 建议先用 '手动输入' · 或等种子库就绪."
        />
      )}

      {contentSource === 'by-tag' && (
        <>
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12, fontSize: 12 }}
            message="⚠ 文案种子库 V1.1 即将上线 · 当前无 tag 数据"
          />
          <Form.Item label="Tag (多选)" name="contentTags">
            <Select
              mode="multiple"
              placeholder="daily / motivational / business / promo / festival"
              options={[
                { value: 'daily', label: 'daily · 日常' },
                { value: 'motivational', label: 'motivational · 励志' },
                { value: 'business', label: 'business · 商业' },
                { value: 'promo', label: 'promo · 促销' },
                { value: 'festival', label: 'festival · 节日' },
                { value: 'humor', label: 'humor · 搞笑' },
                { value: 'foodie', label: 'foodie · 美食' },
                { value: 'lifestyle', label: 'lifestyle · 生活' },
              ]}
            />
          </Form.Item>
        </>
      )}

      {contentSource === 'ai' && (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12, fontSize: 12 }}
            message="🤖 AI 按 persona + 关键词生成文案"
            description="需先在 设置 → AI 配置 里设好 API Key (DeepSeek/Claude/OpenAI/Gemini)."
          />
          <Form.Item label="Persona 描述 (给 AI 的角色设定)" name="aiPersona">
            <Input placeholder="例: 马来华人女 25 岁 · 卖美妆 · 口语化" />
          </Form.Item>
          <Form.Item label="主题关键词 (逗号分隔)" name="aiTheme">
            <Input placeholder="例: 护肤, 促销, 周末折扣" />
          </Form.Item>
          <Form.Item label="生成条数 (1 任务发 N 条)" name="aiCount" initialValue={1}>
            <InputNumber min={1} max={10} style={{ width: '100%' }} />
          </Form.Item>
        </>
      )}

      {contentSource === 'manual' && (
        <Form.Item label="文案 / Caption" name="text" rules={[{ required: true, message: '请输入文案' }]}>
          <TextArea rows={3} placeholder="发到朋友圈的文字..." maxLength={700} showCount />
        </Form.Item>
      )}

      <Form.Item
        noStyle
        shouldUpdate={(prev, cur) => prev.contentType !== cur.contentType}
      >
        {({ getFieldValue }) => {
          const ct = getFieldValue('contentType');
          if (ct === 'image' || ct === 'video' || ct === 'voice') {
            return (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12, fontSize: 12 }}
                message="媒体素材库 V1.1 即将支持从素材库随机挑 · 当前先手动粘 base64"
              />
            );
          }
          return null;
        }}
      </Form.Item>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════
// Follow Channel 字段 · 3 模式
// ════════════════════════════════════════════════════════════════════

// 2026-04-22 · 养号计划 (7/14 天) 不走任务队列 · 调 /group-warmup/start
function WarmupPlanRedirect({ template }: { template: 'v1_7day' | 'v1_14day_full' }) {
  const [groups, setGroups] = useState<Array<{ id: number; name: string; memberCount: number }>>([]);
  const [groupId, setGroupId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void api
      .get<Array<{ id: number; name: string; memberCount: number }>>('/execution-groups')
      .then((r) => setGroups(r.data))
      .catch(() => setGroups([]));
  }, []);

  const handleStart = async () => {
    if (!groupId) {
      message.warning('请选一个执行组');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/group-warmup/start', { groupId, template });
      message.success('养号计划已启动 · 日历将按窗口自动排任务');
    } catch (err) {
      message.error(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={template === 'v1_14day_full' ? '🚀 一键托管 · 14 天' : '🌱 自动养号 · 7 天'}
        description={
          <div style={{ fontSize: 12 }}>
            {template === 'v1_14day_full'
              ? 'Day 1-7 养号 (挂机 + 剧本互聊 + 刷朋友圈) · Day 8-14 运营热身 (加群/好友/回复) · Day 15+ 进入成熟常态. 系统按 §B.2 日历自动排所有子任务 · 一次性搞定 14 天.'
              : 'Day 1-7 养号期 · 挂机保活 + 剧本互聊 + 发朋友圈. Day 8+ 进成熟常态 (默认自动). 新号必跑.'}
            <br />
            <strong>需先在"账号槽位 → 执行组"创建一个组 · 并加 ≥ 2 号进去.</strong>
          </div>
        }
      />
      <Form.Item label="目标执行组" required>
        {groups.length === 0 ? (
          <Alert type="warning" message="还没有执行组 · 请先在 账号槽位 页创建组" />
        ) : (
          <Select
            placeholder="选组"
            value={groupId ?? undefined}
            onChange={(v) => setGroupId(v)}
            options={groups.map((g) => ({
              value: g.id,
              label: `📁 ${g.name} · ${g.memberCount} 号`,
            }))}
          />
        )}
      </Form.Item>
      <Button type="primary" loading={submitting} onClick={handleStart} disabled={!groupId}>
        🚀 启动计划
      </Button>
      <div style={{ marginTop: 12, fontSize: 11, color: '#999' }}>
        提示: 启动后可在 账号槽位 页看计划进度 · 或此页查看生成的子任务.
      </div>
    </div>
  );
}

// 2026-04-22 · 成熟运营期 · Day 15+ · 3 档强度
function MatureOperationRedirect() {
  const [plans, setPlans] = useState<Array<{ id: number; groupId: number; currentDay: number; matureLevel: string | null; group?: { name: string } }>>([]);
  const [planId, setPlanId] = useState<number | null>(null);
  const [level, setLevel] = useState<'light' | 'standard' | 'aggressive'>('standard');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void api
      .get<typeof plans>('/group-warmup')
      .then((r) => setPlans(r.data))
      .catch(() => setPlans([]));
  }, []);

  const selected = plans.find((p) => p.id === planId);
  const eligible = plans.filter((p) => p.currentDay >= 8);

  const handleStart = async () => {
    if (!planId) return message.warning('请选一个养号计划');
    setSubmitting(true);
    try {
      await api.post(`/group-warmup/${planId}/start-mature`, { level });
      message.success(`🌿 成熟运营已开启 · ${levelLabel(level)}`);
    } catch (err) {
      message.error(extractErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <Alert
        type="success"
        showIcon
        style={{ marginBottom: 16 }}
        message="🌿 成熟运营期 · Day 15+ 持续托管"
        description={
          <div style={{ fontSize: 12 }}>
            号已完成 14 天养号+热身 · 进入长期运营阶段. 系统按你选的档位自动排任务 · 保号 + 持续扩张.
            <br />
            <strong>前提</strong>: 号所在执行组已有养号计划 · 当前 Day ≥ 8 (7 天养号后即可开).
          </div>
        }
      />

      <Form.Item label="选择养号计划 (Day ≥ 8)" required>
        {eligible.length === 0 ? (
          <Alert type="warning" message="没有符合条件的计划 · 先跑 7/14 天养号" />
        ) : (
          <Select
            placeholder="选计划"
            value={planId ?? undefined}
            onChange={(v) => setPlanId(v)}
            options={eligible.map((p) => ({
              value: p.id,
              label: `计划 #${p.id} · 组 ${p.group?.name ?? p.groupId} · Day ${p.currentDay}${p.matureLevel ? ` · 当前档: ${levelLabel(p.matureLevel as 'light' | 'standard' | 'aggressive')}` : ''}`,
            }))}
          />
        )}
      </Form.Item>

      <Form.Item label="运营档位" required>
        <Radio.Group value={level} onChange={(e) => setLevel(e.target.value)}>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Radio value="light">
              <strong>🟢 轻度维持</strong> · 6-10 动作/天 · 只要不掉线 · 适合号多懒管
            </Radio>
            <Radio value="standard">
              <strong>🟡 标准运营</strong> · 15-25 动作/天 · 主动+被动 · ⭐推荐默认
            </Radio>
            <Radio value="aggressive">
              <strong>🔴 积极扩张</strong> · 25-40 动作/天 · 高强度主动 · 接受 10-15% 封号风险
            </Radio>
          </Space>
        </Radio.Group>
      </Form.Item>

      {selected?.matureLevel && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={`当前已在跑 ${levelLabel(selected.matureLevel as 'light' | 'standard' | 'aggressive')} · 选新档位将替换`}
        />
      )}

      <Button type="primary" loading={submitting} onClick={handleStart} disabled={!planId}>
        🌿 开启成熟运营
      </Button>

      <div style={{ marginTop: 12, fontSize: 11, color: '#999' }}>
        提示: 可随时从任务调度再次点 🌿 换档位 · 或 `POST /group-warmup/:id/stop-mature` 停用.
      </div>
    </div>
  );
}

function levelLabel(l: 'light' | 'standard' | 'aggressive'): string {
  return l === 'light' ? '🟢 轻度' : l === 'aggressive' ? '🔴 积极' : '🟡 标准';
}

// 2026-04-22 · 素材发送通用字段 (send_voice / send_image / send_video)
function SendMediaFields({ kind }: { kind: 'voice' | 'image' | 'video' }) {
  const [pools, setPools] = useState<Array<{ kind: string; pool: string; count: number }>>([]);
  // 2026-04-22 · 联系人来源: (1) 选中槽位的 WA 联系人 (2) 系统内其他绑定的号
  const [contactGroups, setContactGroups] = useState<
    Array<{ label: string; options: Array<{ value: string; label: string }> }>
  >([]);
  const form = Form.useFormInstance();
  const selectedSlotIds: number[] = (form.getFieldValue('slotIds') ?? []) as number[];
  // 从 SchedulerPage 主组件拿 activeSlots (全部活跃槽位 · 和 ScriptChatFields 相同方式)
  const [allActive, setAllActive] = useState<
    Array<{ id: number; slotIndex: number; phoneNumber: string | null; waNickname: string | null }>
  >([]);

  useEffect(() => {
    void api
      .get<typeof pools>(`/assets/pools?kind=${kind}`)
      .then((r) => setPools(r.data))
      .catch(() => setPools([]));
    void api
      .get<typeof allActive>('/slots')
      .then((r) => setAllActive(r.data.filter((s: { phoneNumber: string | null }) => !!s.phoneNumber)))
      .catch(() => setAllActive([]));
  }, [kind]);

  // 监听 slotIds 变化 · 组合 2 类候选
  useEffect(() => {
    void (async () => {
      const groups: typeof contactGroups = [];

      // 1️⃣ 选中槽位的 WA 联系人
      if (selectedSlotIds && selectedSlotIds.length > 0) {
        const senderSet = new Set(selectedSlotIds);
        const all: Array<{ value: string; label: string }> = [];
        for (const slotId of selectedSlotIds) {
          try {
            const r = await api.get<Array<{ remoteJid: string; displayName: string | null }>>(
              `/slots/${slotId}/contacts`,
            );
            for (const c of r.data) {
              if (!c.remoteJid.endsWith('@s.whatsapp.net')) continue;
              const phone = c.remoteJid.split('@')[0];
              const display = c.displayName && c.displayName !== phone ? `${c.displayName} · ${phone}` : phone;
              all.push({ value: c.remoteJid, label: display });
            }
          } catch {
            /* ignore */
          }
        }
        const uniq = Array.from(new Map(all.map((x) => [x.value, x])).values());
        if (uniq.length > 0) {
          groups.push({ label: `📇 已聊过的联系人 (${uniq.length})`, options: uniq });
        }

        // 2️⃣ 系统内其他号 (排除发送方自己)
        const others = allActive
          .filter((s) => !senderSet.has(s.id) && s.phoneNumber)
          .map((s) => ({
            value: `${s.phoneNumber}@s.whatsapp.net`,
            label: `#${s.slotIndex} · ${s.phoneNumber}${s.waNickname ? ` (${s.waNickname})` : ''}`,
          }));
        if (others.length > 0) {
          groups.push({ label: `📱 系统内其他号 (${others.length})`, options: others });
        }
      }

      setContactGroups(groups);
    })();
  }, [selectedSlotIds.join(','), allActive]);

  const totalContactCount = contactGroups.reduce((s, g) => s + g.options.length, 0);

  return (
    <>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12, fontSize: 12 }}
        message={`系统将从素材池随机挑 ${kind === 'voice' ? '语音' : kind === 'video' ? '视频' : '图片'} · 每个目标发 1 条`}
        description={
          pools.length === 0
            ? '⚠ 素材池为空 · 请先跑 scripts/seed-assets/gen-*.js 下载素材 · 并调 POST /assets/reindex'
            : `可用池: ${pools.map((p) => `${p.pool}(${p.count})`).join(' · ')}`
        }
      />
      <Form.Item label="从哪个池挑 (留空 = 全部池)" name="pool">
        <Select
          allowClear
          placeholder="选一个池 · 或留空让系统从全部池随机"
          options={pools.map((p) => ({
            value: p.pool,
            label: `📁 ${p.pool} · ${p.count} 条`,
          }))}
        />
      </Form.Item>
      <Form.Item label="目标方式" name="targetMode" initialValue="pick">
        <Radio.Group>
          <Radio value="pick">📇 从联系人池挑 (推荐 · 已存在系统里的联系人)</Radio>
          <Radio value="manual">✏ 手填 jid 列表 (外部手机号)</Radio>
          <Radio value="all">🎲 所有个人号联系人 (随机挑 N 人)</Radio>
        </Radio.Group>
      </Form.Item>
      <Form.Item
        noStyle
        shouldUpdate={(prev, cur) => prev.targetMode !== cur.targetMode}
      >
        {({ getFieldValue }) => {
          const mode = getFieldValue('targetMode') ?? 'pick';
          if (mode === 'pick') {
            return (
              <Form.Item
                label={`从联系人池挑 (${totalContactCount} 可选)`}
                name="targetJids"
                extra={
                  totalContactCount === 0
                    ? '请先选上方槽位 · 系统会列已聊过的人 + 其他绑定的号'
                    : '包含: 已聊过的联系人 + 系统内其他绑定的号 (可给其他槽位号发)'
                }
              >
                <Select
                  mode="multiple"
                  placeholder="选一个或多个目标"
                  showSearch
                  optionFilterProp="label"
                  options={contactGroups}
                />
              </Form.Item>
            );
          }
          if (mode === 'manual') {
            return (
              <Form.Item label="jid 列表 (逗号或换行分隔)" name="targetJidsText">
                <Input.TextArea
                  rows={2}
                  placeholder="例: 60168160836@s.whatsapp.net, 60186888168@s.whatsapp.net"
                />
              </Form.Item>
            );
          }
          return null;
        }}
      </Form.Item>
      <Form.Item label="本次最多发几人" name="maxTargets" initialValue={5}>
        <InputNumber min={1} max={20} style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item label="Caption (选填 · 图片/视频可带文字)" name="caption">
        <Input placeholder="可选 · 例: 今天特价 😊" />
      </Form.Item>
      <Row gutter={8}>
        <Col span={12}>
          <Form.Item label="最短间隔 (秒)" name="intervalMinSec" initialValue={30}>
            <InputNumber min={10} max={3600} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col span={12}>
          <Form.Item label="最长间隔 (秒)" name="intervalMaxSec" initialValue={120}>
            <InputNumber min={10} max={3600} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
      </Row>
    </>
  );
}

function FollowChannelFields() {
  const [mode, setMode] = useState<'random' | 'by-tag' | 'manual'>('random');
  const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([]);

  useEffect(() => {
    void api.get<Array<{ tag: string; count: number }>>('/channel-items/tags')
      .then((r) => setTags(r.data))
      .catch(() => setTags([]));
  }, []);

  return (
    <>
      <Form.Item label="Follow 模式" name="followMode" initialValue="random">
        <Radio.Group
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          buttonStyle="solid"
        >
          <Radio.Button value="random">🎲 完全随机</Radio.Button>
          <Radio.Button value="by-tag">🏷 按行业 Tag</Radio.Button>
          <Radio.Button value="manual">✍ 手动指定</Radio.Button>
        </Radio.Group>
      </Form.Item>

      {mode === 'random' && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12, fontSize: 12 }}
          message="从 WAhubX 种子库 + 你本租户频道库随机挑"
          description={`当前素材库共 ${tags.reduce((s, t) => s + t.count, 0)} 条频道 (按 tag 统计去重前)`}
        />
      )}

      {mode === 'by-tag' && (
        <Form.Item
          label="选行业 Tag (多选)"
          name="selectedTags"
          rules={[{ required: true, message: '至少选一个 tag' }]}
          extra={`素材库 tag 分布: ${tags.slice(0, 5).map((t) => `${t.tag}(${t.count})`).join(', ')}${tags.length > 5 ? ` ...+${tags.length - 5}` : ''}`}
        >
          <Select
            mode="multiple"
            placeholder="例如: forex, crypto"
            options={tags.map((t) => ({ value: t.tag, label: `${t.tag} · ${t.count} 条` }))}
          />
        </Form.Item>
      )}

      {mode === 'manual' && (
        <Form.Item
          label="频道邀请 Code"
          name="inviteCode"
          rules={[{ required: true }]}
          extra="whatsapp.com/channel/XXX 的最后一段"
        >
          <Input placeholder="例如: 0029VaXXXXXXXXX" />
        </Form.Item>
      )}

      {(mode === 'random' || mode === 'by-tag') && (
        <Form.Item label="Follow 数量 (个)" name="count" initialValue={5} rules={[{ required: true }]}>
          <InputNumber min={1} max={50} style={{ width: '100%' }} addonAfter="个频道" />
        </Form.Item>
      )}

      <Row gutter={8}>
        <Col span={8}>
          <Form.Item label="每日上限 (个)" name="maxDaily" initialValue={5}>
            <InputNumber min={1} max={50} style={{ width: '100%' }} addonAfter="个/天" />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item label="最短间隔 (秒)" name="intervalMinSec" initialValue={30}>
            <InputNumber min={10} max={3600} style={{ width: '100%' }} addonAfter="秒" />
          </Form.Item>
        </Col>
        <Col span={8}>
          <Form.Item label="最长间隔 (秒)" name="intervalMaxSec" initialValue={180}>
            <InputNumber min={10} max={3600} style={{ width: '100%' }} addonAfter="秒" />
          </Form.Item>
        </Col>
      </Row>
    </>
  );
}

// payload build 工具 · 剥掉通用字段留类型专属
function buildPayload(values: Record<string, unknown>): Record<string, unknown> {
  const commonKeys = new Set([
    'name',
    'slotSource',
    'slotGroupId',
    'slotIds',
    'priority',
    'scheduledAt',
  ]);
  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (!commonKeys.has(k) && v !== undefined && v !== '') payload[k] = v;
  }
  // 2026-04-22 · send_* 任务 · 3 种 targetMode 归一
  //   pick · targetJids 已是 array (Select multiple 返回)
  //   manual · targetJidsText 字符串 → 分隔成 array
  //   all · targetAll=true
  if (typeof payload.targetJidsText === 'string') {
    const jids = (payload.targetJidsText as string)
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (jids.length > 0) payload.targetJids = jids;
    delete payload.targetJidsText;
  }
  if (payload.targetMode === 'all') payload.targetAll = true;
  delete payload.targetMode;
  return payload;
}
