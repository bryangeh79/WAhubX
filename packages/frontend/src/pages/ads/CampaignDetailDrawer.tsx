import { useCallback, useEffect, useRef, useState } from 'react';
import { App, Button, Descriptions, Drawer, Empty, Modal, Progress, Space, Spin, Table, Tabs, Tag, Tooltip, Typography } from 'antd';
import { CopyOutlined, ReloadOutlined, SyncOutlined, ThunderboltOutlined } from '@ant-design/icons';
import {
  campaignsApi,
  tasksApi,
  type Campaign,
  type CampaignRun,
  type CampaignTarget,
  type TaskRunLog,
  CampaignStatus,
} from '@/lib/campaigns-api';
import { extractErrorMessage } from '@/lib/api';
import { describeSchedule } from './wizard/scheduleUtil';
import { CampaignReportTab } from './CampaignReportTab';

function statusTag(s: CampaignStatus) {
  const map: Record<CampaignStatus, { color: string; text: string }> = {
    [CampaignStatus.Draft]: { color: 'default', text: '草稿' },
    [CampaignStatus.Running]: { color: 'green', text: '进行中' },
    [CampaignStatus.Paused]: { color: 'orange', text: '已暂停' },
    [CampaignStatus.Done]: { color: 'blue', text: '已完成' },
    [CampaignStatus.Cancelled]: { color: 'default', text: '已取消' },
  };
  const cfg = map[s];
  return <Tag color={cfg?.color}>{cfg?.text ?? s}</Tag>;
}

function targetStatusTag(s: number) {
  const map: Record<number, { color: string; text: string }> = {
    0: { color: 'default', text: '待发' },
    1: { color: 'processing', text: '已派发' },
    2: { color: 'success', text: '已发' },
    3: { color: 'error', text: '失败' },
    4: { color: 'warning', text: '跳过' },
  };
  const cfg = map[s];
  return <Tag color={cfg?.color}>{cfg?.text ?? s}</Tag>;
}

interface Props {
  campaignId: number | null;
  onClose: () => void;
  onChanged?: () => void;
}

export function CampaignDetailDrawer({ campaignId, onClose, onChanged }: Props) {
  const { message, modal } = App.useApp();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [runs, setRuns] = useState<CampaignRun[]>([]);
  const [targets, setTargets] = useState<CampaignTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [lastTick, setLastTick] = useState<Date | null>(null);
  const [autoPoll, setAutoPoll] = useState(true);
  const [activeTab, setActiveTab] = useState('info');
  const [cloning, setCloning] = useState(false);
  const [logsTaskId, setLogsTaskId] = useState<number | null>(null);
  const pollRef = useRef<number | null>(null);

  // 2026-04-27 · 强推该投放下所有 pending task 立即执行
  // 2026-04-28 · 抽屉 UI 拆掉 "立即执行" 大按钮 (改 per-task 行内按钮 in TaskList)
  // 此处 doRunNow 函数已废弃 · per-task 立即执行在 CampaignTargetTable 实装

  const doClone = async () => {
    if (!campaignId) return;
    setCloning(true);
    try {
      const cloned = await campaignsApi.clone(campaignId);
      message.success(`已复制 · ${cloned.name} · 状态草稿, 请去列表启动`);
      onChanged?.();
    } catch (err) {
      message.error(extractErrorMessage(err, '复制失败'));
    } finally {
      setCloning(false);
    }
  };

  const fetchData = async (silent = false) => {
    if (campaignId === null) return;
    if (!silent) setLoading(true);
    else setPolling(true);
    try {
      const [c, r, t] = await Promise.all([
        campaignsApi.get(campaignId),
        campaignsApi.listRuns(campaignId),
        campaignsApi.listTargets(campaignId),
      ]);
      setCampaign(c);
      setRuns(r);
      setTargets(t);
      setLastTick(new Date());
    } catch (err) {
      if (!silent) message.error(extractErrorMessage(err, '加载详情失败'));
    } finally {
      setLoading(false);
      setPolling(false);
    }
  };

  useEffect(() => {
    if (campaignId === null) {
      setCampaign(null);
      setRuns([]);
      setTargets([]);
      setLastTick(null);
      return;
    }
    void fetchData(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  // P1 · 自动轮询 · Running/Paused 时每 5s 拉一次, 终态时停
  useEffect(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (!autoPoll) return;
    if (campaignId === null) return;
    if (!campaign) return;
    // 终态不 poll
    if (campaign.status === CampaignStatus.Done || campaign.status === CampaignStatus.Cancelled) {
      return;
    }
    pollRef.current = window.setInterval(() => {
      void fetchData(true);
    }, 5000);
    return () => {
      if (pollRef.current !== null) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId, campaign?.status, autoPoll]);

  // 汇总所有 run 的 stats 给顶部进度条用
  const overall = {
    planned: runs.reduce((s, r) => s + (r.stats?.planned ?? 0), 0),
    sent: runs.reduce((s, r) => s + (r.stats?.sent ?? 0), 0),
    failed: runs.reduce((s, r) => s + (r.stats?.failed ?? 0), 0),
    skipped: runs.reduce((s, r) => s + (r.stats?.skipped ?? 0), 0),
  };
  const doneCount = overall.sent + overall.failed + overall.skipped;
  const pct = overall.planned > 0 ? Math.round((doneCount / overall.planned) * 100) : 0;
  const inflight = campaign
    ? campaign.status === CampaignStatus.Running || campaign.status === CampaignStatus.Paused
    : false;

  return (
    <Drawer
      title={
        <Space>
          <span>{campaign ? `投放详情 · ${campaign.name}` : '投放详情'}</span>
          {inflight && polling && (
            <Tag color="processing" icon={<SyncOutlined spin />} style={{ marginLeft: 4 }}>
              同步中
            </Tag>
          )}
        </Space>
      }
      open={campaignId !== null}
      onClose={onClose}
      width={780}
      extra={
        campaign && (
          <Space>
            <Tooltip title="复制这个投放 · 同文案/客户群/节流 · 新的草稿 campaign">
              <Button
                size="small"
                icon={<CopyOutlined />}
                loading={cloning}
                onClick={doClone}
              >
                复制为新投放
              </Button>
            </Tooltip>
            {inflight && (
              <Tooltip title={autoPoll ? '点击暂停自动刷新 · 当前每 5s 自动拉取' : '点击开启自动刷新'}>
                <Button
                  size="small"
                  type={autoPoll ? 'primary' : 'default'}
                  icon={<SyncOutlined spin={autoPoll && polling} />}
                  onClick={() => setAutoPoll((v) => !v)}
                  style={autoPoll ? { background: '#25d366', borderColor: '#25d366' } : undefined}
                >
                  {autoPoll ? '自动刷新' : '已暂停刷新'}
                </Button>
              </Tooltip>
            )}
            <Tooltip title="手动刷新">
              <Button
                size="small"
                icon={<ReloadOutlined />}
                loading={loading}
                onClick={() => fetchData(false)}
              />
            </Tooltip>
          </Space>
        )
      }
    >
      {loading ? (
        <Spin />
      ) : !campaign ? (
        <Empty />
      ) : (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          {/* 实时进度条 */}
          {overall.planned > 0 && (
            <div
              style={{
                padding: 14,
                border: '1px solid #eaeaea',
                borderRadius: 10,
                background: campaign.status === CampaignStatus.Done ? '#f6ffed' : '#fafafa',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: 8,
                }}
              >
                <span style={{ fontSize: 13, color: '#666' }}>
                  总进度 · {doneCount} / {overall.planned}
                </span>
                <span style={{ fontSize: 12, color: '#999' }}>
                  {lastTick ? `更新于 ${lastTick.toLocaleTimeString('zh-CN', { hour12: false })}` : ''}
                </span>
              </div>
              <Progress
                percent={pct}
                status={
                  campaign.status === CampaignStatus.Done
                    ? 'success'
                    : campaign.status === CampaignStatus.Paused
                      ? 'exception'
                      : 'active'
                }
                strokeColor={{ from: '#25d366', to: '#13c2c2' }}
              />
              <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12 }}>
                <span>
                  <Tag color="success" style={{ margin: 0 }}>
                    已发 {overall.sent}
                  </Tag>
                </span>
                <span>
                  <Tag color="error" style={{ margin: 0 }}>
                    失败 {overall.failed}
                  </Tag>
                </span>
                <span>
                  <Tag color="warning" style={{ margin: 0 }}>
                    跳过 {overall.skipped}
                  </Tag>
                </span>
                <span>
                  <Tag style={{ margin: 0 }}>
                    剩余 {overall.planned - doneCount}
                  </Tag>
                </span>
                {overall.planned > 0 && overall.sent > 0 && (
                  <Typography.Text type="secondary">
                    成功率 {Math.round((overall.sent / doneCount) * 100) || 0}%
                  </Typography.Text>
                )}
              </div>

              {/* 2026-04-27 · 待执行任务提示 · 让租户不以为卡住 */}
              {(() => {
                const pending = targets.filter(
                  (t) =>
                    t.taskStatus === 'pending' &&
                    t.scheduledAt &&
                    new Date(t.scheduledAt).getTime() > Date.now() + 60_000,
                );
                if (pending.length === 0) return null;
                const earliest = pending.reduce((min, t) =>
                  !min || (t.scheduledAt && t.scheduledAt < min.scheduledAt!) ? t : min,
                );
                const ts = new Date(earliest.scheduledAt!);
                const diffMs = ts.getTime() - Date.now();
                const diffH = Math.floor(diffMs / 3_600_000);
                const diffM = Math.floor((diffMs % 3_600_000) / 60_000);
                const fmt = ts.toLocaleString('zh-CN', { hour12: false });
                const relative =
                  diffH >= 1
                    ? `${diffH} 小时${diffM > 0 ? ` ${diffM} 分钟` : ''}后`
                    : `${diffM} 分钟后`;
                return (
                  <div
                    style={{
                      marginTop: 10,
                      padding: '8px 12px',
                      background: '#fffbe6',
                      border: '1px solid #ffe58f',
                      borderRadius: 8,
                      fontSize: 12,
                      color: '#666',
                      lineHeight: 1.6,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ marginRight: 6 }}>⏳</span>
                      <b>{pending.length}</b> 个任务等待执行 · 系统按节流时段自动跑 · 下一次:{' '}
                      <b style={{ color: '#fa8c16' }}>{fmt}</b>{' '}
                      <Typography.Text type="secondary">({relative})</Typography.Text>
                    </span>
                    {/* 2026-04-28 · 老的"全局立即执行"按钮删 · 改在下面"目标"表每行 per-task 立即执行 */}
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                      → 切到"目标"标签 · 每行单独 [立即执行]
                    </Typography.Text>
                  </div>
                );
              })()}
            </div>
          )}

          <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'info',
              label: '基本信息',
              children: (
                <Descriptions bordered size="small" column={1}>
                  <Descriptions.Item label="名称">{campaign.name}</Descriptions.Item>
                  <Descriptions.Item label="时间">
                    {describeSchedule(campaign.schedule)}
                  </Descriptions.Item>
                  <Descriptions.Item label="状态">
                    {statusTag(campaign.status)}
                  </Descriptions.Item>
                  <Descriptions.Item label="客户群">
                    {campaign.targets.groupIds?.length ?? 0} 组
                  </Descriptions.Item>
                  <Descriptions.Item label="额外手动号码">
                    {campaign.targets.extraPhones?.length ?? 0} 个
                  </Descriptions.Item>
                  <Descriptions.Item label="广告">
                    {campaign.adIds.length} 条 · {campaign.adStrategy === 1 ? '单一' : '轮换'}
                  </Descriptions.Item>
                  <Descriptions.Item label="开场">
                    {campaign.openingStrategy === 1
                      ? '固定'
                      : campaign.openingStrategy === 2
                        ? '随机'
                        : '不加'}
                    {campaign.openingIds.length > 0 ? ` · ${campaign.openingIds.length} 条` : ''}
                  </Descriptions.Item>
                  <Descriptions.Item label="执行方式">
                    {campaign.executionMode === 1
                      ? '系统智能'
                      : `自定义槽位 (${campaign.customSlotIds.length} 个)`}
                  </Descriptions.Item>
                  <Descriptions.Item label="节流档位">
                    {campaign.throttleProfile === 1
                      ? '保守'
                      : campaign.throttleProfile === 2
                        ? '平衡'
                        : '投放'}
                  </Descriptions.Item>
                  {campaign.safetySnapshot && (
                    <Descriptions.Item label="承载">
                      {campaign.safetySnapshot.message}
                      <div style={{ color: '#888', marginTop: 4 }}>
                        {campaign.safetySnapshot.eligibleSlots} 成熟号 ×{' '}
                        {campaign.safetySnapshot.dailyCap}/天 ×{' '}
                        {campaign.safetySnapshot.days} 天 ={' '}
                        {campaign.safetySnapshot.capacity} 容量 / {campaign.safetySnapshot.totalTargets} 目标
                      </div>
                    </Descriptions.Item>
                  )}
                </Descriptions>
              ),
            },
            {
              key: 'runs',
              label: `触发 (${runs.length})`,
              children: (
                <Table
                  size="small"
                  rowKey="id"
                  dataSource={runs}
                  columns={[
                    {
                      title: '触发时间',
                      dataIndex: 'fireAt',
                      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
                    },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      render: (s: number) => {
                        const m: Record<number, string> = {
                          0: '待触发',
                          1: '进行中',
                          2: '已完成',
                          3: '已取消',
                        };
                        return m[s] ?? s;
                      },
                    },
                    {
                      title: '统计',
                      dataIndex: 'stats',
                      render: (s: CampaignRun['stats']) => {
                        const err = (s as { error?: string })?.error;
                        return (
                          <Space direction="vertical" size={0}>
                            <span>{`发:${s.sent ?? 0} 失:${s.failed ?? 0} 跳:${s.skipped ?? 0} / 计划${s.planned ?? 0}`}</span>
                            {err && (
                              <Typography.Text type="danger" style={{ fontSize: 11 }}>
                                ⚠ {err}
                              </Typography.Text>
                            )}
                          </Space>
                        );
                      },
                    },
                  ]}
                  pagination={false}
                />
              ),
            },
            {
              key: 'targets',
              label: `目标 (${targets.length})`,
              children: (
                <Table
                  size="small"
                  rowKey="id"
                  dataSource={targets}
                  columns={[
                    { title: '号码', dataIndex: 'phoneE164' },
                    {
                      title: '槽位',
                      dataIndex: 'assignedSlotId',
                      width: 80,
                      render: (v: number | null) => (v !== null ? `#${v}` : '—'),
                    },
                    { title: '状态', dataIndex: 'status', width: 90, render: targetStatusTag },
                    {
                      title: '发送',
                      dataIndex: 'sentAt',
                      width: 150,
                      render: (v: string | null) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—'),
                    },
                    {
                      title: '已回复',
                      dataIndex: 'repliedAt',
                      width: 160,
                      render: (v: string | null, row: CampaignTarget) =>
                        v ? (
                          <Tooltip
                            title={`首次回复: ${new Date(v).toLocaleString('zh-CN', { hour12: false })}${row.replyCount > 1 ? ` · 累计 ${row.replyCount} 条` : ''}`}
                          >
                            <Tag color="blue" style={{ margin: 0 }}>
                              💬 {row.replyCount > 1 ? `${row.replyCount} 条` : '已回复'}
                            </Tag>
                          </Tooltip>
                        ) : (
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            —
                          </Typography.Text>
                        ),
                    },
                    {
                      title: '错误',
                      dataIndex: 'errorMsg',
                      render: (v: string | null) => v ?? '—',
                      ellipsis: true,
                    },
                    {
                      title: '操作',
                      key: 'action',
                      width: 200,
                      render: (_: unknown, row: CampaignTarget) => {
                        // 立即执行: 仅 status=1 dispatched + task pending + scheduledAt 未来才显
                        const isFuture =
                          row.scheduledAt &&
                          new Date(row.scheduledAt).getTime() > Date.now() + 30_000;
                        const canRunNow =
                          row.status === 1 && row.taskStatus === 'pending' && isFuture;
                        // 删除: status=1 (dispatched) 都可删 · sent/failed 任务也可清
                        // status=0 (pending · 极少见) 也允许
                        const canDelete = row.status !== 4; // 已 skipped 不再重复删
                        return (
                          <Space size={2}>
                            {row.taskId !== null && (
                              <Button
                                size="small"
                                type="link"
                                onClick={() => setLogsTaskId(row.taskId)}
                                style={{ padding: '0 4px' }}
                              >
                                🔍 日志
                              </Button>
                            )}
                            {canRunNow && (
                              <Button
                                size="small"
                                type="link"
                                icon={<ThunderboltOutlined />}
                                style={{ color: '#fa8c16', padding: '0 4px' }}
                                onClick={() => {
                                  modal.confirm({
                                    title: '立即执行此任务',
                                    content: (
                                      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                                        <div>
                                          号码 <strong>{row.phoneE164}</strong> · 槽位{' '}
                                          <strong>{row.assignedSlotId !== null ? `#${row.assignedSlotId}` : '—'}</strong>
                                        </div>
                                        <div style={{ marginTop: 4 }}>
                                          原计划:{' '}
                                          <strong>
                                            {row.scheduledAt
                                              ? new Date(row.scheduledAt).toLocaleString('zh-CN', { hour12: false })
                                              : '—'}
                                          </strong>
                                        </div>
                                        <div style={{ marginTop: 8, color: '#fa8c16' }}>
                                          ⚠ 仅这一个任务立即执行 · 跳过节流时段+夜间窗口.
                                        </div>
                                      </div>
                                    ),
                                    okText: '立即执行',
                                    okButtonProps: {
                                      style: { background: '#fa8c16', borderColor: '#fa8c16' },
                                    },
                                    cancelText: '取消',
                                    onOk: async () => {
                                      if (!campaignId) return;
                                      try {
                                        const res = await campaignsApi.runNowTarget(
                                          campaignId,
                                          row.id,
                                        );
                                        if (res.pushed) {
                                          message.success(`已强推任务 → ${row.phoneE164}`);
                                        } else {
                                          message.warning(res.reason ?? '强推失败');
                                        }
                                        await fetchData(true);
                                      } catch (err) {
                                        message.error(extractErrorMessage(err, '强推失败'));
                                      }
                                    },
                                  });
                                }}
                              >
                                立即执行
                              </Button>
                            )}
                            {canDelete && (
                              <Button
                                size="small"
                                type="link"
                                danger
                                style={{ padding: '0 4px' }}
                                onClick={() => {
                                  modal.confirm({
                                    title: '删除此任务',
                                    content: (
                                      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                                        <div>
                                          号码 <strong>{row.phoneE164}</strong>
                                        </div>
                                        <div style={{ marginTop: 4, color: '#666' }}>
                                          {row.status === 2
                                            ? '该号已发送过广告 · 删除仅清列表 · 不撤回 WA 消息'
                                            : row.status === 3
                                              ? '失败任务 · 删除清记录'
                                              : '取消未执行任务 + 标记跳过'}
                                        </div>
                                      </div>
                                    ),
                                    okText: '删除',
                                    okButtonProps: { danger: true },
                                    cancelText: '取消',
                                    onOk: async () => {
                                      if (!campaignId) return;
                                      try {
                                        await campaignsApi.cancelTarget(
                                          campaignId,
                                          row.id,
                                        );
                                        message.success(`已删除 → ${row.phoneE164}`);
                                        await fetchData(true);
                                      } catch (err) {
                                        message.error(extractErrorMessage(err, '删除失败'));
                                      }
                                    },
                                  });
                                }}
                              >
                                🗑 删除
                              </Button>
                            )}
                          </Space>
                        );
                      },
                    },
                  ]}
                  pagination={{ pageSize: 20 }}
                />
              ),
            },
            {
              key: 'report',
              label: '📊 结果报告',
              children: campaignId !== null ? (
                <CampaignReportTab campaignId={campaignId} active={activeTab === 'report'} />
              ) : null,
            },
          ]}
        />
        </Space>
      )}
      {/* 任务执行日志 modal · 复用 /tasks/:id/logs · 见 SchedulerPage 同款 */}
      <TaskLogsModal taskId={logsTaskId} onClose={() => setLogsTaskId(null)} />
    </Drawer>
  );
}

// ════════════════════════════════════════════════════════════════════
// 任务执行日志 Modal · 简化版 (相比 SchedulerPage 的 STEP_FRIENDLY 字典 · 直接显原 step)
// ════════════════════════════════════════════════════════════════════
function TaskLogsModal({
  taskId,
  onClose,
}: {
  taskId: number | null;
  onClose: () => void;
}) {
  const [runs, setRuns] = useState<TaskRunLog[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (taskId === null) return;
    setLoading(true);
    try {
      const data = await tasksApi.getLogs(taskId);
      setRuns(data);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    if (taskId === null) return;
    void load();
    // 仅 pending/running 才轮询 · 完成的任务静态显
    const iv = setInterval(() => void load(), 3000);
    return () => clearInterval(iv);
  }, [taskId, load]);

  return (
    <Modal
      open={taskId !== null}
      onCancel={onClose}
      footer={null}
      width={780}
      title={`📜 任务 #${taskId ?? '—'} · 执行日志`}
      destroyOnClose
    >
      {loading && runs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin />
        </div>
      ) : runs.length === 0 ? (
        <Empty description="任务尚未执行 / 无日志记录" />
      ) : (
        <div>
          {runs.map((run) => (
            <div
              key={run.runId}
              style={{
                marginBottom: 16,
                padding: 12,
                background: run.status === 'failed' ? '#fff2f0' : '#fafafa',
                border: `1px solid ${run.status === 'failed' ? '#ffccc7' : '#e8e8e8'}`,
                borderRadius: 8,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <Typography.Text strong>
                  Run #{run.runId} ·{' '}
                  <Tag color={run.status === 'done' ? 'success' : run.status === 'failed' ? 'error' : 'processing'}>
                    {run.status}
                  </Tag>
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {new Date(run.startedAt).toLocaleString('zh-CN', { hour12: false })}
                  {run.finishedAt && ` → ${new Date(run.finishedAt).toLocaleString('zh-CN', { hour12: false })}`}
                </Typography.Text>
              </div>
              {run.errorMessage && (
                <div style={{ marginBottom: 8, padding: 8, background: '#fff', borderRadius: 4 }}>
                  <Typography.Text type="danger" style={{ fontSize: 12 }}>
                    ❌ {run.errorCode ?? 'ERROR'}: {run.errorMessage}
                  </Typography.Text>
                </div>
              )}
              {run.logs && run.logs.length > 0 && (
                <div style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6 }}>
                  {run.logs.map((log, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: 8 }}>
                      <span style={{ color: '#888', flexShrink: 0 }}>
                        {new Date(log.at).toLocaleTimeString('zh-CN', { hour12: false })}
                      </span>
                      <span style={{ color: log.ok ? '#52c41a' : '#f5222d', flexShrink: 0 }}>
                        {log.ok ? '✓' : '✗'}
                      </span>
                      <span style={{ flex: 1 }}>
                        <strong>{log.step}</strong>
                        {log.meta && Object.keys(log.meta).length > 0 && (
                          <span style={{ color: '#666', marginLeft: 6 }}>
                            {JSON.stringify(log.meta)}
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
