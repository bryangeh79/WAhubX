// 2026-04-26 · 仪表盘 UI 重做 · 完全依照参考图 (柔和渐变 / 大号图标 / 状态 pill / 装饰性 SVG)
import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Button, Card, Col, Row, Tag, Typography } from 'antd';
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  CloseCircleFilled,
  CloudServerOutlined,
  DatabaseOutlined,
  InfoCircleFilled,
  LockOutlined,
  PlayCircleFilled,
  ReloadOutlined,
  SafetyCertificateOutlined,
  ThunderboltFilled,
} from '@ant-design/icons';
import { useAuth } from '@/auth/AuthContext';
import { api } from '@/lib/api';

const { Title, Text } = Typography;

const BRAND = '#25d366';

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

// ═══ 参考图配色 (柔和渐变背景 · 每张状态卡用不同色调) ═══
const STATUS_TINTS: Record<string, { bg: string; iconBg: string; iconColor: string }> = {
  backend: { bg: 'linear-gradient(135deg, #f0faf4 0%, #e6f7ee 100%)', iconBg: '#d3f5e0', iconColor: '#25d366' },
  db:      { bg: 'linear-gradient(135deg, #f0f5ff 0%, #e6efff 100%)', iconBg: '#d6e4ff', iconColor: '#2f54eb' },
  auth:    { bg: 'linear-gradient(135deg, #e6fffb 0%, #d6f7f5 100%)', iconBg: '#b5f5ec', iconColor: '#13c2c2' },
  license: { bg: 'linear-gradient(135deg, #f0faf4 0%, #d3f5e0 100%)', iconBg: '#b7eb8f', iconColor: '#25d366' },
};

// ═══ 通用 SectionCard · 标题左侧绿色图标徽章 ═══
function SectionCard({
  icon,
  title,
  children,
  style,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <Card
      style={{
        borderRadius: 16,
        boxShadow: '0 4px 20px rgba(37, 211, 102, 0.06)',
        border: '1px solid #e8f5ec',
        ...style,
      }}
      styles={{ body: { padding: '24px 28px' } }}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #25d366 0%, #128c7e 100%)',
              color: '#fff',
              fontSize: 14,
              boxShadow: '0 2px 6px rgba(37, 211, 102, 0.3)',
            }}
          >
            {icon}
          </span>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#1f1f1f' }}>{title}</span>
        </div>
      }
      bordered={false}
    >
      {children}
    </Card>
  );
}

// ═══ 系统状态单卡 · 大图标 + label + status pill + 右上角绿点 ═══
function StatusCard({
  tintKey,
  icon,
  label,
  ok,
}: {
  tintKey: 'backend' | 'db' | 'auth' | 'license';
  icon: ReactNode;
  label: string;
  ok: boolean;
}) {
  const tint = STATUS_TINTS[tintKey];
  return (
    <div
      style={{
        background: ok ? tint.bg : 'linear-gradient(135deg, #fff1f0 0%, #ffe7e7 100%)',
        borderRadius: 14,
        padding: '24px 16px 20px',
        textAlign: 'center',
        position: 'relative',
        border: '1px solid rgba(0,0,0,0.04)',
        height: '100%',
        transition: 'transform 0.18s ease',
      }}
      onMouseEnter={(e) => ((e.currentTarget.style.transform = 'translateY(-2px)'))}
      onMouseLeave={(e) => ((e.currentTarget.style.transform = 'translateY(0)'))}
    >
      {/* 右上角状态点 */}
      <span
        style={{
          position: 'absolute',
          top: 12,
          right: 14,
          width: 9,
          height: 9,
          borderRadius: '50%',
          background: ok ? BRAND : '#f5222d',
          boxShadow: `0 0 0 3px ${ok ? 'rgba(37,211,102,0.18)' : 'rgba(245,34,45,0.18)'}`,
        }}
      />
      {/* 大图标 platter */}
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          background: ok ? tint.iconBg : '#ffccc7',
          color: ok ? tint.iconColor : '#f5222d',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 30,
          margin: '0 auto 14px',
          boxShadow: ok ? `0 4px 12px ${tint.iconColor}33` : '0 4px 12px rgba(245,34,45,0.2)',
        }}
      >
        {icon}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, color: '#262626', marginBottom: 12 }}>{label}</div>
      <Tag
        color={ok ? 'success' : 'error'}
        style={{
          margin: 0,
          fontSize: 12,
          padding: '2px 10px',
          borderRadius: 12,
          fontWeight: 500,
        }}
      >
        {ok ? '✓ 运行正常' : '✗ 异常'}
      </Tag>
    </div>
  );
}

// ═══ 队列单卡 · 圆形图标 + label + 大数字 + 背景装饰小图 ═══
function QueueCard({
  icon,
  label,
  count,
  iconBg,
  iconColor,
  decoration,
}: {
  icon: ReactNode;
  label: string;
  count: number;
  iconBg: string;
  iconColor: string;
  decoration?: 'bars' | 'line';
}) {
  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 14,
        padding: '18px 22px',
        border: '1px solid #f0f0f0',
        position: 'relative',
        overflow: 'hidden',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}
    >
      {/* 圆形图标 */}
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: '50%',
          background: iconBg,
          color: iconColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 24,
          flexShrink: 0,
          boxShadow: `0 4px 12px ${iconColor}26`,
        }}
      >
        {icon}
      </div>
      {/* 文字区 */}
      <div style={{ flex: 1, minWidth: 0, zIndex: 1 }}>
        <div style={{ fontSize: 13, color: '#8c8c8c', marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: '#1f1f1f', lineHeight: 1 }}>{count}</div>
      </div>
      {/* 背景装饰 (bars / line) */}
      {decoration === 'bars' && (
        <svg
          width="80"
          height="40"
          viewBox="0 0 80 40"
          style={{ position: 'absolute', right: 12, bottom: 8, opacity: 0.35 }}
        >
          <rect x="2" y="20" width="6" height="18" rx="1" fill={iconColor} opacity="0.4" />
          <rect x="14" y="12" width="6" height="26" rx="1" fill={iconColor} opacity="0.5" />
          <rect x="26" y="6" width="6" height="32" rx="1" fill={iconColor} opacity="0.6" />
          <rect x="38" y="14" width="6" height="24" rx="1" fill={iconColor} opacity="0.5" />
          <rect x="50" y="22" width="6" height="16" rx="1" fill={iconColor} opacity="0.4" />
          <rect x="62" y="10" width="6" height="28" rx="1" fill={iconColor} opacity="0.55" />
        </svg>
      )}
      {decoration === 'line' && (
        <svg
          width="100"
          height="40"
          viewBox="0 0 100 40"
          style={{ position: 'absolute', right: 8, bottom: 6, opacity: 0.4 }}
        >
          <polyline
            points="0,30 18,18 32,24 48,8 66,16 82,4 100,12"
            fill="none"
            stroke={iconColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="18" cy="18" r="2.5" fill={iconColor} />
          <circle cx="48" cy="8" r="2.5" fill={iconColor} />
          <circle cx="82" cy="4" r="2.5" fill={iconColor} />
        </svg>
      )}
    </div>
  );
}

// 2026-04-26 · 用户提供的真插画 · 替代 SVG 模拟
// 注: 图放在 frontend/public/ 下 · Vite dev/build 都按 / 根 URL 直供
const HEADER_BG_URL = '/dashboard-header-bg.png';
const SHIELD_URL = '/dashboard-shield.png';

// ═══ Page ═══════════════════════════════════════════════════════════════

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
  const allOk = beOk && licenseOk;

  return (
    // ═══ 页面外层 · 全屏渐变球水印背景 ═══
    // 用 negative margin 抵消 App shell <Content padding:24>, 让 bg 撑到内容区四边
    // backgroundAttachment: fixed 让水印随视口固定 · 内容滚动 bg 不动 · 看上去像桌面墙纸
    <div
      style={{
        position: 'relative',
        margin: -24,
        padding: 24,
        minHeight: 'calc(100vh - 64px)', // 减去 App Header 高
        backgroundImage: `url(${HEADER_BG_URL})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center top',
        backgroundRepeat: 'no-repeat',
        backgroundAttachment: 'fixed',
        backgroundColor: '#f6fbf8', // fallback
      }}
    >
      {/* ═══ 页眉 · 透明背景 · 直接放在全页 bg 上 ═══ */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 12,
          padding: '16px 12px 24px',
          marginBottom: 4,
        }}
      >
        <div>
          <Title level={2} style={{ margin: 0, fontWeight: 700, color: '#1f1f1f', letterSpacing: -0.3 }}>
            仪表盘
          </Title>
          <Text type="secondary" style={{ fontSize: 13 }}>
            查看租户概览、当前账号信息与系统运行状态
          </Text>
        </div>
        <Button
          icon={<ReloadOutlined />}
          onClick={handleRefresh}
          loading={loading}
          style={{ borderRadius: 8, fontWeight: 500, background: 'rgba(255,255,255,0.85)' }}
        >
          刷新信息
        </Button>
      </div>

      {/* ═══ 系统运行状态 ═══ */}
      <SectionCard
        icon={<ThunderboltFilled />}
        title="系统运行状态"
        style={{ marginBottom: 18 }}
      >
        <Row gutter={[16, 16]}>
          <Col xs={12} sm={12} md={6}>
            <StatusCard tintKey="backend" icon={<CloudServerOutlined />} label="后端" ok={beOk} />
          </Col>
          <Col xs={12} sm={12} md={6}>
            <StatusCard tintKey="db" icon={<DatabaseOutlined />} label="数据库" ok={beOk} />
          </Col>
          <Col xs={12} sm={12} md={6}>
            <StatusCard tintKey="auth" icon={<LockOutlined />} label="认证" ok={true} />
          </Col>
          <Col xs={12} sm={12} md={6}>
            <StatusCard tintKey="license" icon={<SafetyCertificateOutlined />} label="License" ok={licenseOk} />
          </Col>
        </Row>

        {/* 汇总 */}
        <div
          style={{
            marginTop: 22,
            textAlign: 'center',
            fontSize: 14,
            color: allOk ? BRAND : '#f5222d',
            fontWeight: 600,
          }}
        >
          <CheckCircleFilled style={{ marginRight: 6 }} />
          {allOk ? '所有服务运行正常' : '有服务异常, 请检查'}
        </div>
        {health && (
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              color: '#8c8c8c',
              display: 'flex',
              justifyContent: 'center',
              gap: 14,
            }}
          >
            <span>版本 {health.version}</span>
            <span style={{ color: '#d9d9d9' }}>·</span>
            <span>
              在线 {Math.floor(health.uptime_sec / 3600)}h {Math.floor((health.uptime_sec % 3600) / 60)}m
            </span>
          </div>
        )}
      </SectionCard>

      {/* ═══ 运营监控 · 任务队列 ═══ */}
      <SectionCard
        icon={<PlayCircleFilled />}
        title="运营监控 · 任务队列"
        style={{ marginBottom: 18 }}
      >
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={8}>
            <QueueCard
              icon={<PlayCircleFilled />}
              label="进行中"
              count={running.length}
              iconBg="#d3f5e0"
              iconColor={BRAND}
            />
          </Col>
          <Col xs={24} sm={8}>
            <QueueCard
              icon={<ClockCircleOutlined />}
              label="排队中"
              count={pending.length}
              iconBg="#d6e4ff"
              iconColor="#1890ff"
              decoration="bars"
            />
          </Col>
          <Col xs={24} sm={8}>
            <QueueCard
              icon={<CloseCircleFilled />}
              label="近 1h 失败"
              count={failed.length}
              iconBg="#ffccc7"
              iconColor="#f5222d"
              decoration="line"
            />
          </Col>
        </Row>

        {/* 正在执行 · 前 5 条 */}
        {running.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 8 }}>正在执行 (前 5 条):</div>
            <Row gutter={[8, 8]}>
              {running.slice(0, 5).map((r) => (
                <Col key={r.id} xs={24} sm={12} md={8} lg={8}>
                  <div
                    style={{
                      padding: '10px 14px',
                      border: '1px solid #f0f0f0',
                      borderRadius: 8,
                      fontSize: 12,
                      background: '#fafafa',
                    }}
                  >
                    <div style={{ fontWeight: 500, color: '#333' }}>{r.task?.taskType ?? 'unknown'}</div>
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

      {/* ═══ 底部 banner · 整条统一蓝 · 盾插图 mix-blend-mode 自然融合 ═══ */}
      <div
        style={{
          position: 'relative',
          // 蓝色取自盾插图本身的浅蓝调 · 让插图边缘的白/浅蓝跟 banner 自然过渡
          background: allOk ? '#e0ecf9' : '#fff7e6',
          border: allOk ? '1px solid #b3d4ff' : '1px solid #ffe7ba',
          borderRadius: 14,
          padding: '20px 28px',
          overflow: 'hidden',
          minHeight: 100,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <InfoCircleFilled
          style={{
            color: allOk ? '#1890ff' : '#fa8c16',
            fontSize: 22,
            marginRight: 14,
            flexShrink: 0,
            zIndex: 1,
          }}
        />
        <Text
          style={{
            fontSize: 14,
            color: '#1f1f1f',
            zIndex: 1,
            position: 'relative',
            flex: 1,
            paddingRight: 200,
          }}
        >
          {allOk
            ? '当前环境运行正常，可继续进行账号配置与广告投放。'
            : '系统状态异常，请检查上方状态面板。'}
        </Text>
        {/* 用户提供的真插画 · mix-blend-mode: multiply 让白边乘上 banner 的蓝 → 无可见接缝 */}
        {allOk && (
          <img
            src={SHIELD_URL}
            alt=""
            style={{
              position: 'absolute',
              right: 0,
              top: '50%',
              transform: 'translateY(-50%)',
              height: 140,
              width: 'auto',
              pointerEvents: 'none',
              userSelect: 'none',
              mixBlendMode: 'multiply', // 关键: 白底变 banner 蓝 · 蓝盾保留 · 边缘自然
            }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        )}
      </div>
    </div>
  );
}
