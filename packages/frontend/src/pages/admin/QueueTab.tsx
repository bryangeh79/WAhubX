import { useCallback, useEffect, useState } from 'react';
import { Alert, Card, Col, Empty, Row, Space, Spin, Tag, Typography } from 'antd';
import { api, extractErrorMessage } from '@/lib/api';

const { Text } = Typography;

interface RunningRun {
  id: number;
  taskId: number;
  accountId: number | null;
  startedAt: string;
  status: 'running';
  task?: {
    id: number;
    taskType: string;
    priority: number;
    tenantId: number;
  };
}

interface TaskItem {
  id: number;
  tenantId: number;
  taskType: string;
  priority: number;
  scheduledAt: string | null;
  targetType: 'account' | 'group';
  targetIds: number[];
  status: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

const POLL_MS = 3000;
const MAX_SLOTS = 6;

export function QueueTab() {
  const [running, setRunning] = useState<RunningRun[]>([]);
  const [pending, setPending] = useState<TaskItem[]>([]);
  const [failed, setFailed] = useState<TaskItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [r, p, f] = await Promise.all([
        api.get<RunningRun[]>('/tasks/queue/running'),
        api.get<TaskItem[]>('/tasks/queue/pending'),
        api.get<TaskItem[]>('/tasks/queue/failed-recent'),
      ]);
      setRunning(r.data);
      setPending(p.data);
      setFailed(f.data);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err, '轮询队列失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      {error && <Alert type="error" message={error} showIcon />}
      <Card size="small" title={`6 并发槽位 · running ${running.length}/${MAX_SLOTS}`}>
        <Row gutter={[8, 8]}>
          {Array.from({ length: MAX_SLOTS }).map((_, i) => {
            const r = running[i];
            return (
              <Col key={i} xs={12} sm={8} md={4}>
                <SlotCell run={r} now={new Date()} />
              </Col>
            );
          })}
        </Row>
      </Card>

      <Card size="small" title={`排队中 · pending ${pending.length}`}>
        {loading ? <Spin /> : pending.length === 0 ? <Empty description="无待调度任务" /> : (
          <PendingTable rows={pending} />
        )}
      </Card>

      <Card size="small" title={`最近失败 (20 条) · failed ${failed.length}`}>
        {loading ? <Spin /> : failed.length === 0 ? <Empty description="无失败任务" /> : (
          <FailedTable rows={failed} />
        )}
      </Card>
    </Space>
  );
}

function SlotCell({ run, now }: { run: RunningRun | undefined; now: Date }) {
  if (!run) {
    return (
      <Card size="small" style={{ textAlign: 'center', minHeight: 88, borderStyle: 'dashed', opacity: 0.6 }}>
        <Text type="secondary">idle</Text>
      </Card>
    );
  }
  const elapsed = Math.floor((now.getTime() - new Date(run.startedAt).getTime()) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return (
    <Card size="small" style={{ textAlign: 'center', minHeight: 88, background: '#e6fffb', borderColor: '#13c2c2' }}>
      <Space direction="vertical" size={0}>
        <Tag color="processing">{run.task?.taskType ?? '?'}</Tag>
        <Text strong>task #{run.taskId}</Text>
        <Text type="secondary" style={{ fontSize: 11 }}>account {run.accountId ?? '?'}</Text>
        <Text type="secondary" style={{ fontSize: 11 }}>{mins}m {secs}s</Text>
      </Space>
    </Card>
  );
}

function PendingTable({ rows }: { rows: TaskItem[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '50px 80px 100px 100px 150px 1fr', gap: 4, fontSize: 12 }}>
      <Text strong>id</Text>
      <Text strong>type</Text>
      <Text strong>target</Text>
      <Text strong>priority</Text>
      <Text strong>scheduled_at</Text>
      <Text strong>created_at</Text>
      {rows.map((t) => (
        <Row key={t.id} style={{ display: 'contents' }}>
          <Text>{t.id}</Text>
          <Tag color="cyan" style={{ margin: 0 }}>{t.taskType}</Tag>
          <Text type="secondary">{t.targetType}·{t.targetIds.join(',')}</Text>
          <Text>{t.priority}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {t.scheduledAt ? new Date(t.scheduledAt).toLocaleString('zh-CN') : 'asap'}
          </Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {new Date(t.createdAt).toLocaleString('zh-CN')}
          </Text>
        </Row>
      ))}
    </div>
  );
}

function FailedTable({ rows }: { rows: TaskItem[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '50px 80px 100px 150px 1fr', gap: 4, fontSize: 12 }}>
      <Text strong>id</Text>
      <Text strong>type</Text>
      <Text strong>target</Text>
      <Text strong>updated_at</Text>
      <Text strong>error</Text>
      {rows.map((t) => (
        <Row key={t.id} style={{ display: 'contents' }}>
          <Text>{t.id}</Text>
          <Tag color="red" style={{ margin: 0 }}>{t.taskType}</Tag>
          <Text type="secondary">{t.targetType}·{t.targetIds.join(',')}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>{new Date(t.updatedAt).toLocaleString('zh-CN')}</Text>
          <Text type="danger" style={{ fontSize: 11 }}>{t.lastError ?? '—'}</Text>
        </Row>
      ))}
    </div>
  );
}
