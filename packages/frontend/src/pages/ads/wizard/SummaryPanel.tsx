import { Card } from 'antd';
import type { ReactNode } from 'react';
import { useWizard, parseExtraPhones } from './WizardContext';
import { describeSchedule } from './scheduleUtil';
import {
  AdStrategy,
  ExecutionMode,
  OpeningStrategy,
  SafetyStatus,
  ThrottleProfile,
  type SafetyPreview,
} from '@/lib/campaigns-api';
import { SummaryStatusChip, type SummaryStatus, CARD_STYLE } from './shared';

const STRATEGY_LABEL: Record<AdStrategy, string> = {
  [AdStrategy.Single]: '单一',
  [AdStrategy.Rotation]: '轮换',
};

const OPENING_LABEL: Record<OpeningStrategy, string> = {
  [OpeningStrategy.Fixed]: '固定',
  [OpeningStrategy.Random]: '随机',
  [OpeningStrategy.None]: '不加',
};

const EXEC_LABEL: Record<ExecutionMode, string> = {
  [ExecutionMode.Smart]: '系统智能',
  [ExecutionMode.CustomSlots]: '自定义槽位',
};

const THROTTLE_LABEL: Record<ThrottleProfile, string> = {
  [ThrottleProfile.Conservative]: '保守',
  [ThrottleProfile.Balanced]: '平衡',
  [ThrottleProfile.Aggressive]: '投放',
};

const DASH = <span style={{ color: '#bbb' }}>—</span>;

interface Props {
  safety?: SafetyPreview | null;
}

interface Row {
  label: string;
  value: ReactNode;
}

function SummaryRow({ label, value, last }: { label: string; value: ReactNode; last: boolean }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '78px 1fr',
        alignItems: 'center',
        padding: '12px 0',
        borderBottom: last ? 'none' : '1px solid #f0f0f0',
        fontSize: 13,
      }}
    >
      <span style={{ color: '#8c8c8c', fontWeight: 400 }}>{label}</span>
      <span style={{ color: '#333', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

export function SummaryPanel({ safety }: Props) {
  const { draft } = useWizard();
  const extraCount = parseExtraPhones(draft.extraPhonesRaw).length;

  // 决定右上角状态条
  let status: SummaryStatus = 'configuring';
  if (safety) {
    if (safety.status === SafetyStatus.Green) status = 'green';
    else if (safety.status === SafetyStatus.Yellow) status = 'yellow';
    else if (safety.status === SafetyStatus.Red) status = 'red';
  }

  const openingText =
    draft.openingStrategy === OpeningStrategy.None
      ? OPENING_LABEL[draft.openingStrategy]
      : draft.openingIds.length > 0
        ? `${OPENING_LABEL[draft.openingStrategy]} · ${draft.openingIds.length} 条`
        : OPENING_LABEL[draft.openingStrategy];

  const execText =
    EXEC_LABEL[draft.executionMode] +
    (draft.executionMode === ExecutionMode.CustomSlots ? ` (${draft.customSlotIds.length})` : '');

  const rows: Row[] = [
    { label: '名称', value: draft.name || DASH },
    { label: '时间', value: describeSchedule(draft.schedule) },
    { label: '客户群', value: draft.groupIds.length > 0 ? `${draft.groupIds.length} 组` : DASH },
    { label: '补充号码', value: extraCount > 0 ? `${extraCount} 个` : DASH },
    {
      label: '广告',
      value:
        draft.adIds.length > 0
          ? `${draft.adIds.length} 条 · ${STRATEGY_LABEL[draft.adStrategy]}`
          : DASH,
    },
    { label: '开场', value: openingText },
    { label: '执行方式', value: execText },
    { label: '节奏', value: THROTTLE_LABEL[draft.throttleProfile] },
  ];

  return (
    <Card
      size="small"
      title={<span style={{ fontSize: 14, fontWeight: 600 }}>本次投放摘要</span>}
      extra={<SummaryStatusChip status={status} />}
      style={{ ...CARD_STYLE, position: 'sticky', top: 0 }}
      styles={{ body: { padding: '4px 16px' } }}
    >
      {rows.map((r, i) => (
        <SummaryRow key={r.label} label={r.label} value={r.value} last={i === rows.length - 1} />
      ))}
    </Card>
  );
}
