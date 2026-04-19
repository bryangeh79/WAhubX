import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Collapse,
  Descriptions,
  Empty,
  InputNumber,
  List,
  Modal,
  Progress,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message as antdMessage,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { api, extractErrorMessage } from '@/lib/api';

const { Text } = Typography;

interface OverviewRow {
  slotIndex: number;
  accountId: number;
  phoneNumber: string;
  warmupStage: number;
  healthScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  updatedAt: string | null;
}

interface Breakdown {
  rule: string;
  delta: number;
  count?: number;
  value?: number | string;
  explanation: string;
}

interface Detail {
  accountId: number;
  score: number;
  riskLevel: 'low' | 'medium' | 'high';
  breakdown: Breakdown[];
  windowDays: number;
  computedAt: string;
  totalSent: number;
  totalReceived: number;
  recentEvents: Array<{
    id: string;
    code: string;
    severity: string;
    source: string;
    at: string;
    meta: Record<string, unknown> | null;
  }>;
  trend7d: Array<{ day: string; count: number }>;
}

const LEVEL_LABEL: Record<string, { text: string; color: string; emoji: string }> = {
  low: { text: '健康', color: '#52c41a', emoji: '🟢' },
  medium: { text: '警告', color: '#faad14', emoji: '🟡' },
  high: { text: '危险', color: '#f5222d', emoji: '🔴' },
};

export function HealthTab() {
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [windowDays, setWindowDays] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overview] = await Promise.all([api.get<OverviewRow[]>('/account-health/overview')]);
      setRows(overview.data);
    } catch (err) {
      setError(extractErrorMessage(err, '加载健康分失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const res = await api.get<{ dryRun: boolean; scoringWindowDays: number }>('/account-health/settings');
      setDryRun(res.data.dryRun);
      setWindowDays(res.data.scoringWindowDays);
    } catch {
      // 非 platform admin 读不到, 忽略
    }
  }, []);

  useEffect(() => {
    void load();
    void loadSettings();
  }, [load, loadSettings]);

  const openDetail = async (accountId: number) => {
    try {
      const res = await api.get<Detail>(`/account-health/${accountId}`);
      setDetail(res.data);
      setDetailOpen(true);
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '加载详情失败'));
    }
  };

  const toggleDryRun = async (v: boolean) => {
    try {
      await api.post('/account-health/settings/dry-run', { enabled: v });
      setDryRun(v);
      antdMessage.success(
        v ? 'Dry-run ON · 降级行为不真执行 (首次 rollout 建议 72h)' : 'Dry-run OFF · 降级行为已生效',
      );
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '切换失败'));
    }
  };

  const saveWindow = async () => {
    try {
      await api.post('/account-health/settings/scoring-window-days', { days: windowDays });
      antdMessage.success(`评分窗口更新为 ${windowDays} 天`);
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '保存失败'));
    }
  };

  const rescore = async (accountId: number) => {
    try {
      await api.post(`/account-health/${accountId}/rescore`);
      antdMessage.success('已重算');
      await load();
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '重算失败'));
    }
  };

  const cols: ColumnsType<OverviewRow> = [
    { title: '槽', dataIndex: 'slotIndex', width: 60 },
    { title: '账号', dataIndex: 'phoneNumber', render: (p) => <Text code>{p}</Text> },
    {
      title: '健康分',
      dataIndex: 'healthScore',
      width: 180,
      render: (s: number, r) => (
        <Progress
          percent={s}
          size="small"
          strokeColor={LEVEL_LABEL[r.riskLevel].color}
          format={() => s}
        />
      ),
    },
    {
      title: '风险等级',
      dataIndex: 'riskLevel',
      width: 100,
      render: (lv: 'low' | 'medium' | 'high') => {
        const info = LEVEL_LABEL[lv];
        return <Tag color={info.color}>{info.emoji} {info.text}</Tag>;
      },
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      render: (t: string | null) => (t ? new Date(t).toLocaleString() : '—'),
    },
    {
      title: '',
      width: 160,
      render: (_, r) => (
        <Space size={4}>
          <Button size="small" onClick={() => void openDetail(r.accountId)}>详情</Button>
          <Button size="small" onClick={() => void rescore(r.accountId)}>重算</Button>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      {error && <Alert type="error" message={error} showIcon />}

      <Alert
        type={dryRun ? 'warning' : 'info'}
        showIcon
        message={
          <Space wrap>
            <Text strong>全局设置</Text>
            <Text>Dry-run</Text>
            <Tooltip title="首次 rollout 必走 72h dry-run · 不真触发 auto-regress / priority 降档 / send_delay 加倍. 弹窗加 [DRY-RUN] 前缀.">
              <Switch size="small" checked={dryRun} onChange={(v) => void toggleDryRun(v)} />
            </Tooltip>
            <Text type="secondary">{dryRun ? '🧪 dry-run 模式 (不真降级)' : '🔒 真降级已生效'}</Text>
            <span style={{ marginLeft: 16 }} />
            <Text>评分窗口</Text>
            <InputNumber
              size="small"
              min={1}
              max={365}
              value={windowDays}
              onChange={(v) => setWindowDays(v ?? 30)}
            />
            <Text type="secondary">天</Text>
            <Button size="small" type="link" onClick={() => void saveWindow()}>保存</Button>
            <Tooltip title="只累加此天数内的 risk_event · 防止 6 个月前的验证码永久扣分">
              <Text style={{ cursor: 'help' }}>ℹ️</Text>
            </Tooltip>
          </Space>
        }
      />

      <Card
        size="small"
        title={`账号健康概览 (${rows.length})`}
        extra={<Button onClick={load} loading={loading} size="small">刷新</Button>}
      >
        {rows.length === 0 ? (
          <Empty description="尚无账号绑定" />
        ) : (
          <Table size="small" rowKey="accountId" dataSource={rows} columns={cols} pagination={false} />
        )}
      </Card>

      <Modal
        title={detail ? `账号 ${detail.accountId} · 健康分详情 (窗口 ${detail.windowDays} 天)` : ''}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={820}
      >
        {detail && <DetailView detail={detail} />}
      </Modal>
    </Space>
  );
}

function DetailView({ detail }: { detail: Detail }) {
  const info = LEVEL_LABEL[detail.riskLevel];
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Descriptions size="small" column={3} bordered>
        <Descriptions.Item label="分数">{detail.score}</Descriptions.Item>
        <Descriptions.Item label="等级">
          <Tag color={info.color}>{info.emoji} {info.text}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="窗口">{detail.windowDays} 天</Descriptions.Item>
        <Descriptions.Item label="累计发送">{detail.totalSent}</Descriptions.Item>
        <Descriptions.Item label="累计接收">{detail.totalReceived}</Descriptions.Item>
        <Descriptions.Item label="重算时间">{new Date(detail.computedAt).toLocaleString()}</Descriptions.Item>
      </Descriptions>

      <Collapse
        defaultActiveKey={[]}
        items={[
          {
            key: 'breakdown',
            label: `扣分/加分明细 (${detail.breakdown.length} 条)`,
            children: detail.breakdown.length === 0 ? (
              <Text type="secondary">当前窗口内无扣分/加分事件 · 保持基线 100</Text>
            ) : (
              <List
                size="small"
                dataSource={detail.breakdown}
                renderItem={(b) => (
                  <List.Item>
                    <Space style={{ width: '100%' }}>
                      <Text code>{b.rule}</Text>
                      <Tag color={b.delta < 0 ? 'red' : 'green'}>{b.delta > 0 ? '+' : ''}{b.delta}</Tag>
                      {b.count !== undefined && <Text type="secondary">× {b.count}</Text>}
                      {b.value !== undefined && <Text type="secondary">[{String(b.value)}]</Text>}
                      <Text style={{ fontSize: 12, color: '#666' }}>{b.explanation}</Text>
                      <Tooltip title={`规则 ${b.rule} 的教育性说明: ${b.explanation}`}>
                        <Text style={{ cursor: 'help' }}>?</Text>
                      </Tooltip>
                    </Space>
                  </List.Item>
                )}
              />
            ),
          },
          {
            key: 'events',
            label: `最近事件 (${detail.recentEvents.length})`,
            children: (
              <List
                size="small"
                dataSource={detail.recentEvents}
                renderItem={(e) => (
                  <List.Item>
                    <Space>
                      <Text type="secondary" style={{ fontSize: 11 }}>{new Date(e.at).toLocaleString()}</Text>
                      <Tag color={e.severity === 'critical' ? 'red' : e.severity === 'warn' ? 'orange' : 'blue'}>
                        {e.severity}
                      </Tag>
                      <Text code>{e.code}</Text>
                      <Text type="secondary" style={{ fontSize: 11 }}>{e.source}</Text>
                    </Space>
                  </List.Item>
                )}
              />
            ),
          },
          {
            key: 'trend',
            label: `7 天趋势 (按天事件数)`,
            children: detail.trend7d.length === 0 ? (
              <Text type="secondary">窗口内无事件</Text>
            ) : (
              <List
                size="small"
                dataSource={detail.trend7d}
                renderItem={(t) => (
                  <List.Item>
                    <Space>
                      <Text>{new Date(t.day).toLocaleDateString()}</Text>
                      <Progress percent={Math.min(100, t.count * 10)} size="small" showInfo={false} style={{ width: 180 }} />
                      <Text code>{t.count} 事件</Text>
                    </Space>
                  </List.Item>
                )}
              />
            ),
          },
        ]}
      />
    </Space>
  );
}
