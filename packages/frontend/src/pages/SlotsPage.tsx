import { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Dropdown, Empty, Row, Space, Spin, Tag, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { api, extractErrorMessage } from '@/lib/api';
import { useAuth } from '@/auth/AuthContext';
import { BindExistingModal } from './bind/BindExistingModal';
import { ChatModal } from './chat/ChatModal';

const { Title, Text } = Typography;

type SlotStatus = 'empty' | 'active' | 'suspended' | 'warmup';

interface SlotItem {
  id: number;
  tenantId: number;
  slotIndex: number;
  status: SlotStatus;
  accountId: number | null;
  phoneNumber: string | null;
  waNickname: string | null;
  warmupStage: number | null;
  proxyId: number | null;
  profilePath: string | null;
  createdAt: string;
}

const STATUS_META: Record<SlotStatus, { label: string; color: string; badge: 'default' | 'processing' | 'success' | 'error' | 'warning' }> = {
  empty: { label: '空置', color: 'default', badge: 'default' },
  warmup: { label: '养号中', color: 'processing', badge: 'processing' },
  active: { label: '运营中', color: 'success', badge: 'success' },
  suspended: { label: '封禁', color: 'error', badge: 'error' },
};

export function SlotsPage() {
  const { user, licenseStatus } = useAuth();
  const [slots, setSlots] = useState<SlotItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bindTarget, setBindTarget] = useState<SlotItem | null>(null);
  const [chatTarget, setChatTarget] = useState<SlotItem | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<SlotItem[]>('/slots');
      setSlots(res.data);
    } catch (err) {
      setError(extractErrorMessage(err, '加载槽位失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const stats = useMemo(() => {
    const byStatus = { empty: 0, warmup: 0, active: 0, suspended: 0 } as Record<SlotStatus, number>;
    slots.forEach((s) => (byStatus[s.status] += 1));
    return byStatus;
  }, [slots]);

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
          <Badge status="default" text={`空置 ${stats.empty}`} />
          <Badge status="processing" text={`养号 ${stats.warmup}`} />
          <Badge status="success" text={`运营 ${stats.active}`} />
          <Badge status="error" text={`封禁 ${stats.suspended}`} />
          <Button size="small" onClick={() => void load()} loading={loading}>刷新</Button>
        </Space>
      </div>

      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

      {loading && slots.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin size="large" />
        </div>
      ) : slots.length === 0 ? (
        <Empty description="还没有槽位 — 请联系管理员重新激活 License" />
      ) : (
        <Row gutter={[12, 12]}>
          {slots.map((slot) => (
            <Col key={slot.id} xs={24} sm={12} md={8} lg={6} xl={4}>
              <SlotCard
                slot={slot}
                onBindExisting={() => setBindTarget(slot)}
                onManage={() => setChatTarget(slot)}
              />
            </Col>
          ))}
        </Row>
      )}

      {bindTarget && (
        <BindExistingModal
          slotId={bindTarget.id}
          slotIndex={bindTarget.slotIndex}
          open={!!bindTarget}
          onClose={() => setBindTarget(null)}
          onSuccess={() => {
            setBindTarget(null);
            void load();
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
    </div>
  );
}

function SlotCard({
  slot,
  onBindExisting,
  onManage,
}: {
  slot: SlotItem;
  onBindExisting: () => void;
  onManage: () => void;
}) {
  const meta = STATUS_META[slot.status];
  const isEmpty = slot.status === 'empty';

  const emptyMenu: MenuProps['items'] = [
    { key: 'bind-existing', label: '扫码绑定现有号 (M2 W1 ✓)', onClick: onBindExisting },
    { key: 'register-new', label: '新号注册 (M2 W3)', disabled: true },
  ];

  return (
    <Card
      size="small"
      style={{
        opacity: isEmpty ? 0.85 : 1,
        borderStyle: isEmpty ? 'dashed' : 'solid',
        minHeight: 160,
      }}
      title={
        <Space>
          <Text strong>#{slot.slotIndex}</Text>
          <Tag color={meta.color}>{meta.label}</Tag>
        </Space>
      }
      extra={
        isEmpty ? (
          <Dropdown menu={{ items: emptyMenu }} trigger={['click']}>
            <Button size="small" type="link">启用 ▾</Button>
          </Dropdown>
        ) : (
          <Button size="small" type="link" onClick={onManage}>管理</Button>
        )
      }
    >
      {isEmpty ? (
        <div style={{ color: '#999', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
          空槽位
          <br />
          <Text type="secondary" style={{ fontSize: 11 }}>
            点右上 "启用" → 扫码
          </Text>
        </div>
      ) : (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Text style={{ fontSize: 13 }}>{slot.phoneNumber ?? '—'}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {slot.waNickname ?? '未设置昵称'}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            阶段 {slot.warmupStage ?? 0}
          </Text>
        </Space>
      )}
    </Card>
  );
}
