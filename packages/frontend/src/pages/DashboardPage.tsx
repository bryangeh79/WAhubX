// 2026-04-24 · 仪表盘重构 · 合并 健康分 + 运营监控 页
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Row, Typography } from 'antd';
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  DatabaseOutlined,
  LockOutlined,
  PlayCircleFilled,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/lib/api';

const { Title, Text } = Typography;

const CARD_STYLE = {
  boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
  borderRadius: 8,
};

const BRAND = '#25d366';
const BRAND_SOFT = '#f0faf4';

interface HealthResp {
  status: string;
  uptime_sec: number;
  version: string;
}

interface RunningRun {
  id: number;
  taskId: number;
  accountId: number | null;
  startedAt: string;
  task?: { taskType: string };
}

interface TaskItem {
  id: number;
  taskType: string;
  status: string;
  createdAt: string;
  lastError: string | null;
}

// ──────────────────────────────────────────────────────────────

function IconBadge({ icon, color = 'white', bg = BRAND, size = 22 }: { icon: React.ReactNode; color?: string; bg?: string; size?: number }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        background: bg,
        borderRadius: 4,
        color,
        fontSize: Math.round(size * 0.55),
        marginRight: 8,
        verticalAlign: 'middle',
        flexShrink: 0,
      }}
    >
      {icon}
    </span>
  );
}

function SectionCard({
  icon,
  title,
  children,
  style,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <Card
      size="small"
      style={{ ...CARD_STYLE, ...(style ?? {}) }}
      styles={{ body: { padding: 20 } }}
      title={
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          <IconBadge icon={icon} />
          {title}
        </span>
      }
    >
      {children}
    </Card>
  );
}

function StatusBox({
  icon,
  label,
  ok,
}: {
  icon: React.ReactNode;
  label: string;
  ok: boolean;
}) {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '20px 12px',
        border: '1px solid #f0f0f0',
        borderRadius: 8,
        background: '#fff',
        position: 'relative',
      }}
    >
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 24,
          background: ok ? BRAND_SOFT : '#fff1f0',
          color: ok ? BRAND : '#f5222d',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 22,
          margin: '0 auto 10px auto',
          position: 'relative',
        }}
      >
        {icon}
        {/* 右上角状态圆点 */}
        <span
          style={{
            position: 'absolute',
            top: -2,
            right: -2,
            width: 14,
            height: 14,
            borderRadius: 7,
            background: ok ? BRAND : '#f5222d',
            border: '2px solid #fff',
            boxShadow: '0 0 0 1px ' + (ok ? BRAND : '#f5222d'),
          }}
        />
      </div>
      <div style={{ fontSize: 13, color: '#1f1f1f', fontWeight: 500 }}>{label}</div>
    </div>
  );
}

function QueueBox({
  icon,
  label,
  count,
  color,
  bg,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  color: string;
  bg: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 18px',
        border: '1px solid #f0f0f0',
        borderRadius: 8,
        background: '#fff',
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          background: bg,
          color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#1f1f1f', lineHeight: 1.1 }}>
          {count}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────

export function DashboardPage() {
  const { user, licenseStatus, refreshLicenseStatus } = useAuth();

  const [health, setHealth] = useState<HealthResp | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [running, setRunning] = useState<RunningRun[]>([]);
  const [pending, setPending] = useState<TaskItem[]>([]);
  const [failed, setFailed] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [h, r, p, f] = await Promise.allSettled([
        api.get<HealthResp>('/health'),
        api.get<RunningRun[]>('/tasks/queue/running'),
        api.get<TaskItem[]>('/tasks/queue/pending'),
        api.get<TaskItem[]>('/tasks/queue/failed-recent'),
      ]);
      if (h.status === 'fulfilled') {
        setHealth(h.value.data);
        setHealthError(false);
      } else {
        setHealthError(true);
      }
      setRunning(r.status === 'fulfilled' ? r.value.data : []);
      setPending(p.status === 'fulfilled' ? p.value.data : []);
      setFailed(f.status === 'fulfilled' ? f.value.data : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
    const t = setInterval(() => void loadAll(), 15_000);
    return () => clearInterval(t);
  }, [loadAll]);

  const handleRefresh = async () => {
    await Promise.all([refreshLicenseStatus().catch(() => undefined), loadAll()]);
  };

  if (!user || !licenseStatus) return null;

  const beOk = !healthError && health?.status === 'ok';
  const licenseOk = licenseStatus.valid && !licenseStatus.revoked;

  return (
    <div>
      {/* 页面头 */}
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
            仪表盘
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            查看租户概览、当前账号信息与系统运行状态
          </Text>
        </div>
        <Button onClick={handleRefresh} loading={loading}>
          🔄 刷新信息
        </Button>
      </div>

      {/* 系统运行状态 */}
      <SectionCard
        icon={<ThunderboltOutlined />}
        title="系统运行状态"
        style={{ marginBottom: 16 }}
      >
        <Row gutter={12}>
          <Col xs={12} sm={6}>
            <StatusBox icon={<DatabaseOutlined />} label="后端" ok={beOk} />
          </Col>
          <Col xs={12} sm={6}>
            <StatusBox icon={<DatabaseOutlined />} label="数据库" ok={beOk} />
          </Col>
          <Col xs={12} sm={6}>
            <StatusBox icon={<LockOutlined />} label="认证" ok={true} />
          </Col>
          <Col xs={12} sm={6}>
            <StatusBox icon={<SafetyCertificateOutlined />} label="License" ok={licenseOk} />
          </Col>
        </Row>

        {/* 汇总行 · 替代各自的"已就绪"文字 */}
        <div
          style={{
            marginTop: 14,
            textAlign: 'center',
            fontSize: 13,
            color: beOk && licenseOk ? BRAND : '#f5222d',
            fontWeight: 500,
          }}
        >
          {beOk && licenseOk ? '✓ 所有服务运行正常' : '⚠ 有服务异常, 请检查'}
        </div>
        {health && (
          <div
            style={{
              marginTop: 14,
              fontSize: 12,
              color: '#8c8c8c',
              display: 'flex',
              justifyContent: 'center',
              gap: 16,
            }}
          >
            <span>版本 {health.version}</span>
            <span>·</span>
            <span>
              在线 {Math.floor(health.uptime_sec / 3600)}h {Math.floor((health.uptime_sec % 3600) / 60)}m
            </span>
          </div>
        )}
      </SectionCard>

      {/* 运营监控 · 任务队列 */}
      <SectionCard
        icon={<PlayCircleFilled />}
        title="运营监控 · 任务队列"
        style={{ marginBottom: 16 }}
      >
        <Row gutter={12}>
          <Col xs={24} sm={8}>
            <QueueBox
              icon={<PlayCircleFilled />}
              label="进行中"
              count={running.length}
              color="#25d366"
              bg={BRAND_SOFT}
            />
          </Col>
          <Col xs={24} sm={8}>
            <QueueBox
              icon={<ClockCircleOutlined />}
              label="排队中"
              count={pending.length}
              color="#1890ff"
              bg="#e6f7ff"
            />
          </Col>
          <Col xs={24} sm={8}>
            <QueueBox
              icon={<CloseCircleFilled />}
              label="近 1h 失败"
              count={failed.length}
              color="#f5222d"
              bg="#fff1f0"
            />
          </Col>
        </Row>

        {running.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 8 }}>正在执行 (前 5 条):</div>
            <Row gutter={[8, 8]}>
              {running.slice(0, 5).map((r) => (
                <Col key={r.id} xs={24} sm={12} md={8} lg={8}>
                  <div
                    style={{
                      padding: '8px 12px',
                      border: '1px solid #e8e8e8',
                      borderRadius: 6,
                      fontSize: 12,
                      background: '#fafafa',
                    }}
                  >
                    <div style={{ fontWeight: 500, color: '#333' }}>
                      {r.task?.taskType ?? 'unknown'}
                    </div>
                    <div style={{ color: '#8c8c8c', fontSize: 11, marginTop: 2 }}>
                      account #{r.accountId ?? '—'} · 起于{' '}
                      {new Date(r.startedAt).toLocaleTimeString('zh-CN', { hour12: false })}
                    </div>
                  </div>
                </Col>
              ))}
            </Row>
          </div>
        )}
      </SectionCard>

      {/* 底部提示 */}
      <Alert
        type={beOk && licenseOk ? 'info' : 'warning'}
        showIcon
        message={
          beOk && licenseOk
            ? '当前环境运行正常, 可继续进行账号配置与广告投放.'
            : '系统状态异常, 请检查上方状态面板.'
        }
        style={{
          border: beOk && licenseOk ? '1px solid #91d5ff' : '1px solid #ffe7ba',
          background: beOk && licenseOk ? '#e6f7ff' : '#fff7e6',
        }}
        icon={beOk && licenseOk ? <CheckCircleFilled style={{ color: '#1890ff' }} /> : undefined}
      />
    </div>
  );
}
