import { useEffect, useMemo, useState } from 'react';
import {
  App,
  Button,
  Card,
  Col,
  Dropdown,
  Input,
  Progress,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  type MenuProps,
  type TableColumnsType,
} from 'antd';
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  campaignsApi,
  type Campaign,
  CampaignStatus,
  SafetyStatus,
} from '@/lib/campaigns-api';
import { extractErrorMessage } from '@/lib/api';
import { describeSchedule } from './wizard/scheduleUtil';
import { CreateCampaignModal } from './wizard/CreateCampaignModal';
import { CampaignDetailDrawer } from './CampaignDetailDrawer';
import { AdvertisementDrawer } from './resources/AdvertisementDrawer';
import { OpeningLineDrawer } from './resources/OpeningLineDrawer';
import { CustomerGroupDrawer } from './resources/CustomerGroupDrawer';

const { Title, Text } = Typography;

// 2026-04-24 · 广告投放首页 · 重构版: 大标题 + KPI 4 卡 + 搜索筛选 + 列表

function statusTag(s: CampaignStatus) {
  switch (s) {
    case CampaignStatus.Draft:
      return <Tag>草稿</Tag>;
    case CampaignStatus.Running:
      return <Tag color="green">进行中</Tag>;
    case CampaignStatus.Paused:
      return <Tag color="orange">已暂停</Tag>;
    case CampaignStatus.Done:
      return <Tag color="blue">已完成</Tag>;
    case CampaignStatus.Cancelled:
      return <Tag color="default">已取消</Tag>;
    default:
      return <Tag>{s}</Tag>;
  }
}

function safetyTag(s: SafetyStatus) {
  switch (s) {
    case SafetyStatus.Green:
      return <Tag color="green">正常</Tag>;
    case SafetyStatus.Yellow:
      return <Tag color="orange">偏紧</Tag>;
    case SafetyStatus.Red:
      return <Tag color="red">风险</Tag>;
    default:
      return null;
  }
}

interface KpiItem {
  icon: React.ReactNode;
  label: string;
  value: number;
  bg: string;
  color: string;
}

function KpiCard({ item }: { item: KpiItem }) {
  return (
    <div
      style={{
        border: '1px solid #e8e8e8',
        borderRadius: 8,
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: '#fff',
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          background: item.bg,
          color: item.color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          flexShrink: 0,
        }}
      >
        {item.icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 2 }}>{item.label}</div>
        <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.1, color: '#1f1f1f' }}>
          {item.value}
        </div>
      </div>
    </div>
  );
}

export function AdsHomePage() {
  const { message, modal } = App.useApp();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [adsDrawer, setAdsDrawer] = useState(false);
  const [openingDrawer, setOpeningDrawer] = useState(false);
  const [groupsDrawer, setGroupsDrawer] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | 'all'>('all');

  const reload = async () => {
    setLoading(true);
    try {
      const list = await campaignsApi.list();
      setCampaigns(list);
    } catch (err) {
      message.error(extractErrorMessage(err, '加载投放列表失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  // KPI 统计
  const stats = useMemo(
    () => ({
      total: campaigns.length,
      running: campaigns.filter((c) => c.status === CampaignStatus.Running).length,
      draft: campaigns.filter((c) => c.status === CampaignStatus.Draft).length,
      done: campaigns.filter((c) => c.status === CampaignStatus.Done).length,
    }),
    [campaigns],
  );

  const kpis: KpiItem[] = [
    { icon: <AppstoreOutlined />, label: '全部', value: stats.total, bg: '#f0faf4', color: '#25d366' },
    { icon: <PlayCircleOutlined />, label: '进行中', value: stats.running, bg: '#f0faf4', color: '#25d366' },
    { icon: <FileTextOutlined />, label: '草稿', value: stats.draft, bg: '#f0faf4', color: '#25d366' },
    { icon: <CheckCircleOutlined />, label: '已完成', value: stats.done, bg: '#f0faf4', color: '#25d366' },
  ];

  // 过滤
  const filtered = useMemo(() => {
    return campaigns.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (searchQuery.trim() && !c.name.toLowerCase().includes(searchQuery.toLowerCase().trim())) {
        return false;
      }
      return true;
    });
  }, [campaigns, searchQuery, statusFilter]);

  const copyMenu: MenuProps['items'] = [
    { key: 'ads', label: '广告文案', onClick: () => setAdsDrawer(true) },
    { key: 'open', label: '开场白', onClick: () => setOpeningDrawer(true) },
  ];

  const columns: TableColumnsType<Campaign> = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (v: string, row) => (
        <a onClick={() => setDetailId(row.id)} style={{ fontWeight: 500 }}>
          {v}
        </a>
      ),
    },
    {
      title: '时间安排',
      key: 'schedule',
      render: (_: unknown, row) => describeSchedule(row.schedule),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (s: CampaignStatus) => statusTag(s),
    },
    {
      title: '安全',
      dataIndex: 'safetyStatus',
      key: 'safety',
      render: (s: SafetyStatus, row) => (
        <Tooltip title={row.safetySnapshot?.message ?? ''}>{safetyTag(s)}</Tooltip>
      ),
    },
    {
      title: '进度',
      key: 'progress',
      render: (_: unknown, row) => {
        const snap = row.safetySnapshot;
        if (!snap) return <span style={{ color: '#999' }}>—</span>;
        const pct =
          snap.totalTargets > 0
            ? Math.min(100, Math.round((snap.capacity / snap.totalTargets) * 100))
            : 0;
        return <Progress percent={pct} size="small" style={{ width: 120 }} />;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      key: 'op',
      render: (_: unknown, row) => (
        <Space size="small">
          {/* 2026-04-28 · 详情 → 日志 (跟 targets 表"日志"按钮一致 · 抽屉显基本信息+触发+目标+报告) */}
          <Button size="small" type="link" onClick={() => setDetailId(row.id)}>
            🔍 日志
          </Button>
          {/* 2026-04-28 · 立即执行 · 强推所有 pending task · 跳节流 + 夜间窗口 */}
          {(row.status === CampaignStatus.Running || row.status === CampaignStatus.Paused) && (
            <Button
              size="small"
              type="link"
              icon={<ThunderboltOutlined />}
              style={{ color: '#fa8c16', padding: '0 4px' }}
              onClick={() => {
                modal.confirm({
                  title: '立即执行所有 pending 任务',
                  content: (
                    <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                      <div>
                        投放 <strong>{row.name}</strong>
                      </div>
                      <div style={{ marginTop: 6, color: '#666' }}>
                        把该投放下所有等待中的任务的 <strong>scheduled_at</strong> 改 NOW · 跳过节流时段 + 夜间窗口
                      </div>
                      <div style={{ marginTop: 8, color: '#fa8c16' }}>
                        ⚠ 立即执行会使任务集中在短时间内发送 · 可能增加封号风险
                      </div>
                    </div>
                  ),
                  okText: '立即执行',
                  okButtonProps: { style: { background: '#fa8c16', borderColor: '#fa8c16' } },
                  cancelText: '取消',
                  onOk: async () => {
                    try {
                      const res = await campaignsApi.runNow(row.id);
                      if (res.pushed > 0) {
                        message.success(`已强推 ${res.pushed} 个任务`);
                      } else {
                        message.info('当前没有等待中的任务');
                      }
                      await reload();
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
          {row.status === CampaignStatus.Running && (
            <Button
              size="small"
              type="link"
              icon={<ThunderboltOutlined />}
              style={{ color: '#fa8c16', padding: '0 4px' }}
              onClick={() => {
                modal.confirm({
                  title: '立即执行',
                  content: (
                    <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                      <div>
                        将该投放下所有<strong>等待中</strong>的任务的执行时间改为<strong>现在</strong>,
                        跳过节流窗口立即派发.
                      </div>
                      <div style={{ marginTop: 8, color: '#fa8c16' }}>
                        ⚠️ 立即执行会使任务集中在短时间内发送, 可能增加封号风险. 仅建议测试或紧急投放使用.
                      </div>
                    </div>
                  ),
                  okText: '立即执行',
                  okButtonProps: { style: { background: '#fa8c16', borderColor: '#fa8c16' } },
                  cancelText: '取消',
                  onOk: async () => {
                    try {
                      const res = await campaignsApi.runNow(row.id);
                      if (res.pushed > 0) {
                        message.success(`已强推 ${res.pushed} 个任务立即执行`);
                      } else {
                        message.info('当前没有等待中的任务可强推');
                      }
                      await reload();
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
          {row.status === CampaignStatus.Running && (
            <Button
              size="small"
              type="link"
              onClick={async () => {
                try {
                  await campaignsApi.pause(row.id);
                  message.success('已暂停');
                  await reload();
                } catch (err) {
                  message.error(extractErrorMessage(err, '暂停失败'));
                }
              }}
            >
              暂停
            </Button>
          )}
          {row.status === CampaignStatus.Paused && (
            <Button
              size="small"
              type="link"
              onClick={async () => {
                try {
                  await campaignsApi.resume(row.id);
                  message.success('已恢复');
                  await reload();
                } catch (err) {
                  message.error(extractErrorMessage(err, '恢复失败'));
                }
              }}
            >
              恢复
            </Button>
          )}
          {row.status === CampaignStatus.Draft && (
            <Button
              size="small"
              type="link"
              onClick={async () => {
                try {
                  await campaignsApi.start(row.id);
                  message.success('已启动');
                  await reload();
                } catch (err) {
                  message.error(extractErrorMessage(err, '启动失败'));
                }
              }}
            >
              启动
            </Button>
          )}
          {/* 2026-04-28 · 删除按钮 · cancelled 状态不再重复显 */}
          {row.status !== CampaignStatus.Cancelled && (
            <Button
              size="small"
              type="link"
              danger
              onClick={() => {
                const isActive =
                  row.status === CampaignStatus.Running || row.status === CampaignStatus.Paused;
                modal.confirm({
                  title: '删除投放任务',
                  content: (
                    <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                      <div>
                        投放 <strong>{row.name}</strong>
                      </div>
                      <div style={{ marginTop: 6, color: '#666' }}>
                        {isActive
                          ? '当前在跑 · 删除会取消所有 pending 任务 · 已发送的不撤回'
                          : row.status === CampaignStatus.Done
                            ? '已完成投放 · 删除清列表 · 报告/统计仍可在后端查'
                            : '取消投放 · 不再排期'}
                      </div>
                    </div>
                  ),
                  okText: '删除',
                  okButtonProps: { danger: true },
                  cancelText: '取消',
                  onOk: async () => {
                    try {
                      await campaignsApi.remove(row.id);
                      message.success(`已删除 → ${row.name}`);
                      await reload();
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
      ),
    },
  ];

  const emptyIllustration = (
    <div
      style={{
        padding: '48px 0 32px 0',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 120,
          height: 120,
          margin: '0 auto 16px auto',
          borderRadius: '50%',
          background: '#f0faf4',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 56,
        }}
      >
        📢
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: '#333', marginBottom: 6 }}>
        还没有投放任务
      </div>
      <div style={{ fontSize: 13, color: '#8c8c8c', marginBottom: 16 }}>
        点击右上角"新建投放"创建第一个广告
      </div>
      <Button type="default" onClick={() => setWizardOpen(true)}>
        去新建投放
      </Button>
    </div>
  );

  return (
    <div>
      {/* 页面头 · 大标题 + 副标题 + 右侧操作 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <Title level={3} style={{ margin: 0 }}>
            广告投放
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            管理广告任务、排期与执行状态
          </Text>
        </div>
        <Space>
          <Tooltip title="刷新列表">
            <Button icon={<ReloadOutlined />} onClick={reload} loading={loading} />
          </Tooltip>
          <Button icon={<TeamOutlined />} onClick={() => setGroupsDrawer(true)}>
            客户群管理
          </Button>
          <Dropdown menu={{ items: copyMenu }}>
            <Button icon={<FileTextOutlined />}>文案 ▾</Button>
          </Dropdown>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            style={{ background: '#25d366', borderColor: '#25d366' }}
            onClick={() => setWizardOpen(true)}
          >
            新建投放
          </Button>
        </Space>
      </div>

      {/* KPI 4 卡 */}
      <Card
        size="small"
        style={{
          marginBottom: 16,
          boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
        }}
        styles={{ body: { padding: 16 } }}
      >
        <Row gutter={12}>
          {kpis.map((k) => (
            <Col key={k.label} xs={12} sm={6}>
              <KpiCard item={k} />
            </Col>
          ))}
        </Row>
      </Card>

      {/* 列表 · 搜索筛选 + 表格 */}
      <Card
        size="small"
        style={{ boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}
        styles={{ body: { padding: 16 } }}
      >
        <Space style={{ marginBottom: 16 }} size={12}>
          <Input
            placeholder="搜索投放名称"
            prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: 240 }}
            allowClear
          />
          <Select
            value={statusFilter}
            onChange={(v) => setStatusFilter(v)}
            style={{ width: 140 }}
            options={[
              { value: 'all', label: '全部状态' },
              { value: CampaignStatus.Draft, label: '草稿' },
              { value: CampaignStatus.Running, label: '进行中' },
              { value: CampaignStatus.Paused, label: '已暂停' },
              { value: CampaignStatus.Done, label: '已完成' },
              { value: CampaignStatus.Cancelled, label: '已取消' },
            ]}
          />
        </Space>

        <Table
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={loading}
          pagination={filtered.length > 20 ? { pageSize: 20 } : false}
          locale={{
            emptyText: campaigns.length === 0 ? emptyIllustration : (
              <div style={{ padding: 24, textAlign: 'center', color: '#8c8c8c' }}>
                没有匹配的投放任务
              </div>
            ),
          }}
        />
      </Card>

      <CreateCampaignModal
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSuccess={async () => {
          setWizardOpen(false);
          await reload();
        }}
      />

      <CampaignDetailDrawer
        campaignId={detailId}
        onClose={() => setDetailId(null)}
        onChanged={reload}
      />

      <AdvertisementDrawer open={adsDrawer} onClose={() => setAdsDrawer(false)} />
      <OpeningLineDrawer open={openingDrawer} onClose={() => setOpeningDrawer(false)} />
      <CustomerGroupDrawer open={groupsDrawer} onClose={() => setGroupsDrawer(false)} />
    </div>
  );
}
