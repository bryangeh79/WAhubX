// 2026-04-24 · 智能客服概览 · KPI 卡 + 快捷跳转
import { Card, Space, Tag, Typography } from 'antd';
import {
  BookOutlined,
  MessageOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type {
  KnowledgeBase,
  TenantReplySettings,
} from '@/lib/intelligent-reply-api';

const BRAND = '#25d366';
const BRAND_SOFT = '#f0faf4';

interface Props {
  kbs: KnowledgeBase[];
  activeKb: KnowledgeBase | null;
  settings: TenantReplySettings;
}

export function ReplyOverviewPanel({ kbs, activeKb, settings }: Props) {
  const modeText =
    settings.mode === 'off' ? '已关闭' : settings.mode === 'smart' ? '智能' : '草稿';

  const tips = (() => {
    if (kbs.length === 0) return '创建第一个知识库开始';
    const empty = activeKb && settings.defaultKbId === null;
    if (empty) return '请把一个知识库设为"默认", 否则自动回复无法工作';
    return null;
  })();

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      {/* 4 格 KPI */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
        }}
      >
        <StatCard
          icon={<BookOutlined />}
          label="知识库"
          value={kbs.length}
          hint={settings.defaultKbId ? `默认 #${settings.defaultKbId}` : '未设默认'}
        />
        <StatCard
          icon={<MessageOutlined />}
          label="当前模式"
          value={modeText}
          valueColor={settings.mode === 'off' ? '#999' : BRAND}
          hint={`每日上限 ${settings.dailyAiReplyLimit}`}
        />
        <StatCard
          icon={<ThunderboltOutlined />}
          label="静默时段"
          value={settings.quietHoursEnabled ? `${settings.quietHoursStart}-${settings.quietHoursEnd}` : '关'}
          valueColor={settings.quietHoursEnabled ? '#fa8c16' : '#999'}
          hint="租户时区"
        />
        <StatCard
          icon={<span>⛔</span>}
          label="禁止话题"
          value={settings.blacklistKeywords.length}
          hint="黑名单词"
        />
      </div>

      {/* 使用指引 */}
      {tips && (
        <Card
          style={{
            background: BRAND_SOFT,
            border: `1px solid ${BRAND}`,
            borderRadius: 10,
          }}
        >
          <Space>
            <Tag color="success">提示</Tag>
            <span>{tips}</span>
          </Space>
        </Card>
      )}

      {/* 工作流图 · 轻量 */}
      <Card title="客户回复怎么处理的" styles={{ body: { padding: 16 } }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
          <FlowBox label="客户回复广告" color={BRAND} />
          <Arrow />
          <FlowBox label="聚合 8s" color="#1677ff" />
          <Arrow />
          <FlowBox label="FAQ 命中?" color="#722ed1" />
          <Arrow />
          <FlowBox label="AI 检索知识库" color="#fa8c16" />
          <Arrow />
          <FlowBox label="Guardrail 过滤" color="#eb2f96" />
          <Arrow />
          <FlowBox label="发送 / 转人工" color={BRAND} />
        </div>
        <Typography.Text
          type="secondary"
          style={{ fontSize: 12, marginTop: 10, display: 'block' }}
        >
          💡 需要人工处理的对话会出现在 "人工接管" tab 的待处理列表
        </Typography.Text>
      </Card>
    </Space>
  );
}

function StatCard({
  icon,
  label,
  value,
  valueColor,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  valueColor?: string;
  hint?: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 16px',
        border: '1px solid #eaeaea',
        borderRadius: 10,
        background: BRAND_SOFT,
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          background: '#fff',
          color: BRAND,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 12, color: '#666' }}>{label}</div>
        <div
          style={{
            fontSize: 20,
            fontWeight: 600,
            color: valueColor ?? '#333',
            lineHeight: 1.1,
            marginTop: 2,
          }}
        >
          {typeof value === 'number' ? value.toLocaleString() : value}
        </div>
        {hint && (
          <div style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>{hint}</div>
        )}
      </div>
    </div>
  );
}

function FlowBox({ label, color }: { label: string; color: string }) {
  return (
    <div
      style={{
        padding: '6px 12px',
        borderRadius: 16,
        background: `${color}10`,
        color,
        border: `1px solid ${color}40`,
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      {label}
    </div>
  );
}

function Arrow() {
  return <span style={{ color: '#bbb' }}>→</span>;
}
