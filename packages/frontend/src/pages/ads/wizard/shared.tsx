import type { ReactNode } from 'react';
import {
  CalendarOutlined,
  CheckCircleFilled,
  ContactsOutlined,
  FieldTimeOutlined,
  FlagOutlined,
  MessageOutlined,
  NotificationOutlined,
  PlayCircleOutlined,
  SafetyCertificateOutlined,
  ScheduleOutlined,
  SoundOutlined,
  SyncOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { ScheduleMode } from '@/lib/campaigns-api';

// 2026-04-24 · 向导共享样式组件 · 品牌绿 #25d366

const BRAND = '#25d366';
const BRAND_SOFT = '#f0faf4';
const BRAND_BORDER = '#8ee2ad';

export { BRAND, BRAND_SOFT };

// 2026-04-24 · 向导卡片统一阴影 · 租户能明显区分卡片边界
export const CARD_SHADOW = '0 2px 10px rgba(0, 0, 0, 0.08), 0 1px 3px rgba(0, 0, 0, 0.04)';

export const CARD_STYLE = {
  boxShadow: CARD_SHADOW,
  borderRadius: 8,
  border: '1px solid #eaeaea',
};

// 小绿色方块图标徽章 · 用在卡片标题前
export function IconBadge({ icon }: { icon: ReactNode }): JSX.Element {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 22,
        height: 22,
        background: BRAND,
        borderRadius: 4,
        color: 'white',
        fontSize: 12,
        marginRight: 8,
        verticalAlign: 'middle',
      }}
    >
      {icon}
    </span>
  );
}

export function CardTitle({ icon, children }: { icon: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <span style={{ fontSize: 14, fontWeight: 600 }}>
      <IconBadge icon={icon} />
      {children}
    </span>
  );
}

// 各卡片用的图标快捷引用
export const CardIcons = {
  name: <FlagOutlined />,
  time: <FieldTimeOutlined />,
  target: <ContactsOutlined />,
  adContent: <NotificationOutlined />,
  opening: <MessageOutlined />,
  executor: <TeamOutlined />,
  throttle: <ThunderboltOutlined />,
  safety: <SafetyCertificateOutlined />,
  sound: <SoundOutlined />,
};

// ──────────────────────────────────────────────────────────────
// 自定义 Steps Bar · 数字圆 + 标题 + 副标题
// ──────────────────────────────────────────────────────────────

export interface StepItem {
  title: string;
  subtitle: string;
}

export function CustomSteps({ current, items }: { current: number; items: StepItem[] }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '8px 0 24px 0',
        width: '100%',
        overflow: 'hidden',
      }}
    >
      {items.map((item, i) => {
        const isActive = i === current;
        const isDone = i < current;
        const isFuture = i > current;
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              flex: i < items.length - 1 ? '1 1 0' : '0 0 auto',
              minWidth: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, minWidth: 0 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  background: isDone || isActive ? BRAND : '#f0f0f0',
                  color: isDone || isActive ? 'white' : '#999',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 16,
                  fontWeight: 600,
                  boxShadow: isActive ? '0 0 0 4px #d6f3e0' : 'none',
                  transition: 'all 0.2s',
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </div>
              <div style={{ marginLeft: 10, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 14,
                    color: isActive ? BRAND : isFuture ? '#999' : '#333',
                    lineHeight: 1.3,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.title}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: '#999',
                    lineHeight: 1.3,
                    marginTop: 2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {item.subtitle}
                </div>
              </div>
            </div>
            {i < items.length - 1 && (
              <div
                style={{
                  flex: 1,
                  height: 2,
                  background: isDone ? BRAND : '#e8e8e8',
                  margin: '0 14px',
                  minWidth: 16,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// 时间模式按钮组 (4 个时间模式横排, 卡片样式)
// ──────────────────────────────────────────────────────────────

interface TimeOption {
  value: ScheduleMode;
  icon: ReactNode;
  label: string;
}

const TIME_OPTIONS: TimeOption[] = [
  { value: 'immediate', icon: <PlayCircleOutlined />, label: '立即开始' },
  { value: 'once', icon: <CalendarOutlined />, label: '单次定时' },
  { value: 'daily', icon: <SyncOutlined />, label: '每天' },
  { value: 'weekly', icon: <ScheduleOutlined />, label: '每周' },
];

export function TimeModePicker({
  value,
  onChange,
}: {
  value: ScheduleMode;
  onChange: (v: ScheduleMode) => void;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      {TIME_OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <div
            key={opt.value}
            onClick={() => onChange(opt.value)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onChange(opt.value);
            }}
            style={{
              flex: 1,
              padding: '14px 12px',
              border: active ? `2px solid ${BRAND}` : '1px solid #d9d9d9',
              borderRadius: 8,
              background: active ? BRAND_SOFT : '#fff',
              color: active ? BRAND : '#333',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              fontWeight: active ? 600 : 500,
              fontSize: 14,
              position: 'relative',
              userSelect: 'none',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              if (!active) (e.currentTarget.style.borderColor = BRAND_BORDER);
            }}
            onMouseLeave={(e) => {
              if (!active) (e.currentTarget.style.borderColor = '#d9d9d9');
            }}
          >
            <span style={{ fontSize: 16, display: 'flex' }}>{opt.icon}</span>
            <span>{opt.label}</span>
            {active && (
              <CheckCircleFilled
                style={{
                  position: 'absolute',
                  right: 6,
                  bottom: 6,
                  color: BRAND,
                  fontSize: 14,
                  background: 'white',
                  borderRadius: '50%',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// 可选择卡片 · 用于"账号来源 / 节奏档位"等单选场景
// ──────────────────────────────────────────────────────────────

interface SelectableCardProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}

export function SelectableCard({ active, onClick, children }: SelectableCardProps): JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        border: active ? `2px solid ${BRAND}` : '1px solid #e0e0e0',
        background: active ? BRAND_SOFT : '#fff',
        borderRadius: 8,
        padding: active ? '13px 15px' : '14px 16px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        transition: 'all 0.15s',
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget.style.borderColor = BRAND_BORDER);
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget.style.borderColor = '#e0e0e0');
      }}
    >
      <RadioCircle active={active} />
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

function RadioCircle({ active }: { active: boolean }): JSX.Element {
  return (
    <div
      style={{
        flexShrink: 0,
        width: 18,
        height: 18,
        borderRadius: 9,
        border: active ? `5px solid ${BRAND}` : '2px solid #bfbfbf',
        background: '#fff',
        marginTop: 2,
        transition: 'all 0.15s',
      }}
    />
  );
}

export function RecommendBadge(): JSX.Element {
  return (
    <span
      style={{
        display: 'inline-block',
        marginLeft: 8,
        padding: '1px 6px',
        background: BRAND_SOFT,
        color: BRAND,
        border: `1px solid ${BRAND_BORDER}`,
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 500,
        verticalAlign: 'middle',
      }}
    >
      推荐
    </span>
  );
}

// ──────────────────────────────────────────────────────────────
// Summary Panel 右上角状态条
// ──────────────────────────────────────────────────────────────

export type SummaryStatus = 'configuring' | 'green' | 'yellow' | 'red';

export function SummaryStatusChip({ status }: { status: SummaryStatus }): JSX.Element {
  const cfg = {
    configuring: { color: BRAND, bg: BRAND_SOFT, text: '准备配置中' },
    green: { color: '#52c41a', bg: '#f6ffed', text: '可启动' },
    yellow: { color: '#fa8c16', bg: '#fff7e6', text: '承载偏紧' },
    red: { color: '#f5222d', bg: '#fff1f0', text: '承载不足' },
  }[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 10px',
        background: cfg.bg,
        color: cfg.color,
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          background: cfg.color,
          display: 'inline-block',
        }}
      />
      {cfg.text}
    </span>
  );
}
