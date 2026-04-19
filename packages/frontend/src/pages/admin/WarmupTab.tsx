import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Descriptions,
  Empty,
  Modal,
  Popconfirm,
  Progress,
  Space,
  Table,
  Tag,
  Typography,
  message as antdMessage,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { api, extractErrorMessage } from '@/lib/api';

const { Text } = Typography;

interface PlanRow {
  id: number;
  account_id: number;
  phoneNumber: string;
  template: string;
  current_phase: number;
  current_day: number;
  paused: boolean;
  regress_reason: string | null;
  last_advanced_at: string | null;
  history: Array<{ at: string; event: string; fromPhase?: number; toPhase?: number; reason?: string }>;
}

const PHASE_LABEL: Record<number, { label: string; color: string }> = {
  0: { label: '孵化 Phase 0', color: '#8c8c8c' },
  1: { label: '预热 Phase 1', color: '#faad14' },
  2: { label: '激活 Phase 2', color: '#1677ff' },
  3: { label: '成熟 Phase 3', color: '#52c41a' },
};

const TOTAL_DAYS = 14;

export function WarmupTab() {
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<PlanRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<PlanRow[]>('/warmup/plans');
      setRows(res.data);
    } catch (err) {
      setError(extractErrorMessage(err, '加载养号计划失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const action = async (accountId: number, path: string, body: Record<string, unknown> = {}) => {
    try {
      await api.post(`/warmup/plans/${accountId}/${path}`, body);
      antdMessage.success('OK');
      await load();
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '操作失败'));
    }
  };

  const cols: ColumnsType<PlanRow> = [
    { title: '账号', dataIndex: 'phoneNumber', render: (v) => <Text code>{v}</Text> },
    {
      title: 'Phase',
      dataIndex: 'current_phase',
      width: 140,
      render: (p: number) => {
        const { label, color } = PHASE_LABEL[p] ?? { label: `Phase ${p}`, color: '#000' };
        return <Tag color={color}>{label}</Tag>;
      },
    },
    {
      title: 'Day 进度',
      width: 260,
      render: (_, r) => (
        <Space direction="vertical" size={2} style={{ width: '100%' }}>
          <Progress
            percent={Math.min(100, (r.current_day / TOTAL_DAYS) * 100)}
            size="small"
            format={() => `Day ${r.current_day} / ${TOTAL_DAYS}`}
          />
          <Text type="secondary" style={{ fontSize: 11 }}>
            last advance: {r.last_advanced_at ? new Date(r.last_advanced_at).toLocaleString() : '—'}
          </Text>
        </Space>
      ),
    },
    {
      title: '状态',
      width: 100,
      render: (_, r) =>
        r.paused ? (
          <Badge status="warning" text="已暂停" />
        ) : r.regress_reason ? (
          <Badge status="error" text="已回退" />
        ) : (
          <Badge status="processing" text="推进中" />
        ),
    },
    {
      title: '回退原因',
      dataIndex: 'regress_reason',
      render: (r: string | null) => (r ? <Text type="danger" style={{ fontSize: 11 }}>{r}</Text> : <Text type="secondary">—</Text>),
    },
    {
      title: '',
      width: 340,
      render: (_, r) => (
        <Space size={4} wrap>
          <Button size="small" onClick={() => setDetail(r)}>详情</Button>
          <Popconfirm
            title="跳到下一 Phase?"
            description="此操作会把 day 推到下一 phase 的起始日, 记录 skip 事件. 不可撤销 (只能让 regress 再回退)."
            onConfirm={() => void action(r.account_id, 'skip-phase', { reason: '管理员手动' })}
            disabled={r.current_phase >= 3}
          >
            <Button size="small" type="primary" disabled={r.current_phase >= 3}>
              跳到下一 Phase
            </Button>
          </Popconfirm>
          {r.paused ? (
            <Button size="small" onClick={() => void action(r.account_id, 'resume')}>
              恢复
            </Button>
          ) : (
            <Button size="small" onClick={() => void action(r.account_id, 'pause', { reason: '管理员手动' })}>
              暂停
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      {error && <Alert type="error" message={error} showIcon />}
      <Card
        size="small"
        title={`养号计划 (${rows.length})`}
        extra={
          <Space>
            <Button onClick={load} loading={loading} size="small">刷新</Button>
          </Space>
        }
      >
        {rows.length === 0 ? (
          <Empty description="尚无计划 — 新号激活完扫码后自动建 Day 1 plan (POST /warmup/plans/:accountId/init)" />
        ) : (
          <Table size="small" rowKey="id" dataSource={rows} columns={cols} pagination={false} />
        )}
      </Card>

      <Modal
        title={detail ? `${detail.phoneNumber} · 事件流` : ''}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={null}
        width={720}
      >
        {detail && (
          <>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="Template">{detail.template}</Descriptions.Item>
              <Descriptions.Item label="当前 Phase">{PHASE_LABEL[detail.current_phase]?.label}</Descriptions.Item>
              <Descriptions.Item label="Current Day">{detail.current_day}</Descriptions.Item>
              <Descriptions.Item label="Paused">{detail.paused ? '是' : '否'}</Descriptions.Item>
              <Descriptions.Item label="Regress Reason" span={2}>{detail.regress_reason ?? '—'}</Descriptions.Item>
            </Descriptions>
            <pre style={{ maxHeight: 360, overflow: 'auto', fontSize: 11, marginTop: 12 }}>
              {JSON.stringify(detail.history, null, 2)}
            </pre>
          </>
        )}
      </Modal>
    </Space>
  );
}
