// 2026-04-26 · P0.10b · TakeoverPage 收敛 · 删旧过渡 chat UI · 单焦点客服接管中心
// 设计 (用户执行令):
//   1. 顶部状态卡: CS slot (slotIndex / phone / online / runtime / heartbeat)
//   2. 主操作区: 单按钮 "开始人工接管" · 当前阶段走 bringToFront 真 WA Web 窗口
//   3. 下方单一容器: 未来 CDP screencast / 系统内嵌窗口 落点 · 现在文案占位
// 不做: iframe / 假 chat UI / 多 slot 列表 / 复杂控制栏
import { useEffect, useState } from 'react';
import { Alert, Card, Space, Tag, Typography } from 'antd';
import { RobotOutlined, MessageOutlined } from '@ant-design/icons';
import { api } from '@/lib/api';
import { TakeoverEmbeddedWindow } from './takeover/TakeoverEmbeddedWindow';
import { CustomerArchivePanel } from './takeover/CustomerArchivePanel';

const { Title, Text, Paragraph } = Typography;

const BRAND = '#25d366';
const BRAND_SOFT = '#f0faf4';

interface CsSlotInfo {
  id: number;
  slotIndex: number;
  phoneNumber: string | null;
  status: string;
  online: boolean;
  runtime?: 'baileys' | 'chromium';
  socketLastHeartbeatAt?: string | null;
  accountId: number | null;
}

export function TakeoverPage() {
  const [csSlot, setCsSlot] = useState<CsSlotInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    try {
      const res = await api.get<
        Array<{
          id: number;
          slotIndex: number;
          status: string;
          role: string;
          phoneNumber: string | null;
          online?: boolean;
          runtime?: 'baileys' | 'chromium';
          socketLastHeartbeatAt?: string | null;
          accountId?: number | null;
        }>
      >('/slots');
      const cs = res.data.find((s) => s.role === 'customer_service');
      setCsSlot(
        cs
          ? {
              id: cs.id,
              slotIndex: cs.slotIndex,
              phoneNumber: cs.phoneNumber,
              status: cs.status,
              online: !!cs.online,
              runtime: cs.runtime,
              socketLastHeartbeatAt: cs.socketLastHeartbeatAt ?? null,
              accountId: cs.accountId ?? null,
            }
          : null,
      );
    } catch (err) {
      console.warn('load CS slot failed', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // 每 30s 刷一次状态 · 让在线/心跳保持新鲜
    const t = setInterval(() => void reload(), 30_000);
    return () => clearInterval(t);
  }, []);

  const heartbeatAgo = (() => {
    if (!csSlot?.socketLastHeartbeatAt) return null;
    const ms = Date.now() - new Date(csSlot.socketLastHeartbeatAt).getTime();
    if (ms < 60_000) return `${Math.round(ms / 1000)} 秒前`;
    if (ms < 3600_000) return `${Math.round(ms / 60_000)} 分钟前`;
    return `${Math.round(ms / 3600_000)} 小时前`;
  })();

  const canTakeover = !!csSlot && csSlot.online && csSlot.runtime === 'chromium';

  return (
    <div>
      {/* 页眉 */}
      <div style={{ marginBottom: 20 }}>
        <Title level={3} style={{ margin: 0 }}>
          <MessageOutlined style={{ color: BRAND, marginRight: 8 }} />
          客服接管中心
        </Title>
        <Text type="secondary">客服号专属操作面 · 接管期间所有自动化对该号暂停</Text>
      </div>

      {/* ── 块 A · 顶部状态卡 ──────────────── */}
      <Card
        size="small"
        loading={loading}
        style={{
          marginBottom: 16,
          background: canTakeover ? BRAND_SOFT : '#fafafa',
          border: canTakeover ? `1px solid ${BRAND}` : '1px solid #e0e0e0',
          borderRadius: 10,
        }}
      >
        {csSlot ? (
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <Space size={10} wrap>
              <RobotOutlined style={{ fontSize: 18, color: BRAND }} />
              <Text strong style={{ fontSize: 15 }}>
                客服号 #{csSlot.slotIndex}
              </Text>
              <Text style={{ fontSize: 14 }}>
                {csSlot.phoneNumber ?? <Text type="secondary">拉取真号中...</Text>}
              </Text>
              {csSlot.online ? (
                <Tag color="green">● 在线</Tag>
              ) : (
                <Tag color="orange">● 离线</Tag>
              )}
              {csSlot.runtime === 'chromium' && <Tag color="blue">Chromium 路径</Tag>}
              {csSlot.runtime === 'baileys' && <Tag color="default">Baileys 路径</Tag>}
            </Space>
            {heartbeatAgo && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                最近心跳: {heartbeatAgo}
              </Text>
            )}
          </Space>
        ) : (
          <Alert
            type="warning"
            showIcon
            message="当前租户没有客服号 (customer_service)"
            description='请到 "账号槽位" 把某 slot 角色切为客服号 · 或先扫码绑定客服号'
          />
        )}
      </Card>

      {/* ── 块 B · 状态提示 (P0.10++ canvas 自动连 · 不再需"开始接管"按钮 · 删避免误导) ──────────────── */}
      {csSlot && !canTakeover && csSlot.runtime !== 'chromium' && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="当前不在 Chromium 路径"
          description="接管功能仅在 RUNTIME_MODE=chromium 时启用"
        />
      )}
      {csSlot && !canTakeover && csSlot.runtime === 'chromium' && !csSlot.online && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="客服号当前离线"
          description='请到 "账号槽位" 点扫码绑定 · 让客服号 rehydrate 后再回来接管'
        />
      )}

      {/* ── 块 C · 接管窗口落点容器 (P0.10++ · 真 CDP screencast 嵌入) ──────────────── */}
      <Card
        size="small"
        style={{
          borderRadius: 10,
          background: '#000',
          padding: 0,
          marginBottom: 16,
        }}
        styles={{ body: { padding: 4 } }}
      >
        {canTakeover ? (
          <TakeoverEmbeddedWindow slotId={csSlot!.id} enableInput={true} />
        ) : (
          <div style={{ minHeight: 360, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: '#fff', padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 56, color: '#bfbfbf', marginBottom: 16 }}>🪟</div>
            <Title level={5} style={{ margin: 0, marginBottom: 8, color: '#fff' }}>
              系统内接管窗口区域
            </Title>
            <Paragraph style={{ fontSize: 12, color: '#bbb', margin: 0, marginBottom: 4 }}>
              {!csSlot ? '请先绑定客服号' :
                !csSlot.online ? '客服号离线 · 请先扫码绑定 / rehydrate' :
                csSlot.runtime !== 'chromium' ? '当前不在 Chromium 路径' :
                '准备就绪'}
            </Paragraph>
          </div>
        )}
      </Card>

      {/* ── 块 D · 客户档案 · 只读·历史消息存档 (P0.10c) ──────────────── */}
      {csSlot?.accountId ? (
        <Card size="small" style={{ borderRadius: 10 }}>
          <CustomerArchivePanel
            slotId={csSlot.id}
            accountId={csSlot.accountId}
            slotLabel={`客服号 #${csSlot.slotIndex} · ${csSlot.phoneNumber ?? '—'}`}
          />
        </Card>
      ) : (
        <Card size="small" style={{ borderRadius: 10 }}>
          <Alert
            type="info"
            showIcon
            message="客户档案 · 等客服号绑定后显示"
            description="客服号绑定 (account_id 写入) 后 · 这里显客户名单 + 历史消息存档 · 仅只读"
          />
        </Card>
      )}
    </div>
  );
}
