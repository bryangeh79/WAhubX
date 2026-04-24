// 2026-04-24 · 模式切换大卡 · 3 选 1 SelectableCard 样式
import { Card, Space, Tag, Tooltip, Typography } from 'antd';
import {
  CheckCircleFilled,
  PoweroffOutlined,
  QuestionCircleOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import type { KnowledgeBase, ReplyMode } from '@/lib/intelligent-reply-api';

const BRAND = '#25d366';
const BRAND_SOFT = '#f0faf4';
const CARD_STYLE = {
  boxShadow: '0 2px 10px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)',
  borderRadius: 10,
  border: '1px solid #eaeaea',
};

interface Props {
  mode: ReplyMode;
  defaultKb: KnowledgeBase | null;
  onChange: (mode: ReplyMode) => void;
}

export function ReplyModeCard({ mode, defaultKb, onChange }: Props) {
  const modes: Array<{
    key: ReplyMode;
    icon: React.ReactNode;
    title: string;
    desc: string;
    hint?: string;
    recommend?: boolean;
  }> = [
    {
      key: 'off',
      icon: <PoweroffOutlined />,
      title: '关闭',
      desc: '所有回复 100% 人工处理',
    },
    {
      key: 'faq',
      icon: <QuestionCircleOutlined />,
      title: 'FAQ 模式',
      desc: '只用 FAQ 匹配 · 命中就回 · 不命中转人工',
      hint: '无需 AI Key',
    },
    {
      key: 'smart',
      icon: <RobotOutlined />,
      title: 'AI 智能 + FAQ',
      desc: 'FAQ 优先 · 不命中用 AI 兜底',
      hint: '需配 AI Key',
      recommend: true,
    },
  ];

  return (
    <Card
      title={
        <Space>
          <span>自动回复模式</span>
          {!defaultKb && mode !== 'off' && (
            <Tag color="warning">未设默认知识库 · 可能无法工作</Tag>
          )}
          {defaultKb && (
            <Tag color="blue">
              使用知识库 · {defaultKb.name}
            </Tag>
          )}
        </Space>
      }
      style={CARD_STYLE}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
        }}
      >
        {modes.map((m) => {
          const selected = mode === m.key;
          return (
            <div
              key={m.key}
              role="button"
              tabIndex={0}
              onClick={() => onChange(m.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onChange(m.key);
                }
              }}
              style={{
                position: 'relative',
                border: selected ? `2px solid ${BRAND}` : '1px solid #e0e0e0',
                background: selected ? BRAND_SOFT : '#fff',
                borderRadius: 10,
                padding: selected ? '15px 16px' : '16px',
                cursor: 'pointer',
                transition: 'all 0.15s',
                textAlign: 'center',
              }}
            >
              {m.recommend && !selected && (
                <Tag
                  color="success"
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    fontSize: 10,
                    margin: 0,
                  }}
                >
                  推荐
                </Tag>
              )}
              {selected && (
                <CheckCircleFilled
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 10,
                    color: BRAND,
                    fontSize: 18,
                  }}
                />
              )}
              <div
                style={{
                  fontSize: 28,
                  color: selected ? BRAND : '#8c8c8c',
                  marginBottom: 8,
                }}
              >
                {m.icon}
              </div>
              <div
                style={{
                  fontWeight: 600,
                  fontSize: 15,
                  color: selected ? BRAND : '#333',
                  marginBottom: 4,
                }}
              >
                {m.title}
              </div>
              <div style={{ fontSize: 12, color: '#8c8c8c', lineHeight: 1.5, marginBottom: 4 }}>
                {m.desc}
              </div>
              {m.hint && (
                <Tag
                  color={m.key === 'faq' ? 'green' : m.key === 'smart' ? 'blue' : 'default'}
                  style={{ margin: 0, fontSize: 11 }}
                >
                  {m.hint}
                </Tag>
              )}
            </div>
          );
        })}
      </div>
      {(mode === 'smart' || mode === 'faq') && (
        <Tooltip title="系统默认 · 30 分钟内同号不重复回复 · 24 小时最多 3 次 · 连续问价/见面自动转人工">
          <div
            style={{
              marginTop: 12,
              fontSize: 12,
              color: '#8c8c8c',
              textAlign: 'center',
            }}
          >
            ℹ️ 内部频率/夜间/去重规则全自动 · 无需配置 (悬停查看)
          </div>
        </Tooltip>
      )}
      <div
        style={{
          marginTop: 12,
          fontSize: 12,
          color: '#8c8c8c',
          textAlign: 'center',
        }}
      >
        <Typography.Text type="secondary">
          模式切换立即生效 · 进入"人工接管"tab 的对话永远不会被 AI 插嘴
        </Typography.Text>
      </div>
    </Card>
  );
}
