import { useEffect, useState } from 'react';
import { Alert, Card, Descriptions, Space, Tag, Typography } from 'antd';
import {
  adsApi,
  openingLinesApi,
  customerGroupsApi,
  type Advertisement,
  type OpeningLine,
  type CustomerGroup,
  AdStrategy,
  ExecutionMode,
  OpeningStrategy,
  SafetyStatus,
  ThrottleProfile,
  type SafetyPreview,
} from '@/lib/campaigns-api';
import { parseExtraPhones, useWizard } from './WizardContext';
import { describeSchedule } from './scheduleUtil';
import { CARD_STYLE } from './shared';

// 2026-04-23 · Step 4 · 确认启动

const THROTTLE_LABEL: Record<ThrottleProfile, string> = {
  [ThrottleProfile.Conservative]: '保守',
  [ThrottleProfile.Balanced]: '平衡',
  [ThrottleProfile.Aggressive]: '投放',
};

const OPENING_LABEL: Record<OpeningStrategy, string> = {
  [OpeningStrategy.Fixed]: '固定开场',
  [OpeningStrategy.Random]: '随机开场',
  [OpeningStrategy.None]: '不加开场',
};

function safetyTag(s: SafetyStatus | undefined) {
  if (s === undefined) return null;
  if (s === SafetyStatus.Green) return <Tag color="green">安全</Tag>;
  if (s === SafetyStatus.Yellow) return <Tag color="orange">偏紧</Tag>;
  if (s === SafetyStatus.Red) return <Tag color="red">风险</Tag>;
  return null;
}

export function StepConfirm({ safety }: { safety: SafetyPreview | null }) {
  const { draft } = useWizard();
  const [ads, setAds] = useState<Advertisement[]>([]);
  const [openings, setOpenings] = useState<OpeningLine[]>([]);
  const [groups, setGroups] = useState<CustomerGroup[]>([]);

  useEffect(() => {
    if (draft.adIds.length > 0) {
      void Promise.all(draft.adIds.map((id) => adsApi.get(id).catch(() => null))).then((list) =>
        setAds(list.filter((x): x is Advertisement => x !== null)),
      );
    }
    if (draft.openingIds.length > 0) {
      void openingLinesApi.list().then((all) => setOpenings(all.filter((o) => draft.openingIds.includes(o.id))));
    }
    if (draft.groupIds.length > 0) {
      void customerGroupsApi
        .list()
        .then((all) => setGroups(all.filter((g) => draft.groupIds.includes(g.id))));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const extraPhones = parseExtraPhones(draft.extraPhonesRaw);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" style={CARD_STYLE}>
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="投放名称">{draft.name || '(未填)'}</Descriptions.Item>
          <Descriptions.Item label="投放时间">{describeSchedule(draft.schedule)}</Descriptions.Item>
          <Descriptions.Item label="投放对象">
            <Space direction="vertical" size={2}>
              {groups.length > 0 && (
                <div>
                  客户群: {groups.map((g) => `${g.name} (${g.memberCount})`).join(' · ')}
                </div>
              )}
              {extraPhones.length > 0 && <div>手动补充号码: {extraPhones.length} 个</div>}
              {safety && (
                <div>
                  去重后目标人数: <b>{safety.totalTargets}</b>
                </div>
              )}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="广告内容">
            <Space direction="vertical" size={4}>
              <span>{draft.adStrategy === AdStrategy.Single ? '单一广告' : '多广告轮换'}</span>
              {ads.map((a) => (
                <div key={a.id} style={{ color: '#555', fontSize: 13 }}>
                  · {a.name}
                </div>
              ))}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="开场方式">
            <Space direction="vertical" size={4}>
              <span>{OPENING_LABEL[draft.openingStrategy]}</span>
              {openings.map((o) => (
                <div key={o.id} style={{ color: '#555', fontSize: 13 }}>
                  · {o.name} — {o.content}
                </div>
              ))}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="执行方式">
            {draft.executionMode === ExecutionMode.Smart ? (
              <span>系统智能安排</span>
            ) : (
              <span>自定义槽位 · 选了 {draft.customSlotIds.length} 个</span>
            )}
          </Descriptions.Item>
          <Descriptions.Item label="节奏">{THROTTLE_LABEL[draft.throttleProfile]}</Descriptions.Item>
          <Descriptions.Item label="安全状态">
            <Space direction="vertical" size={4}>
              {safetyTag(safety?.status)}
              {safety && <Typography.Text type="secondary">{safety.message}</Typography.Text>}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="系统保护">
            <Space direction="vertical" size={2}>
              <div>✓ 异常账号自动跳过</div>
              <div>✓ 风险暂停保护开启</div>
              <div>✓ 补位不足提醒开启</div>
              <div>✓ 同 IP 组互斥 · 夜间窗口保护 · 接管中自动跳过</div>
            </Space>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {safety?.status === SafetyStatus.Red && (
        <Alert
          type="error"
          showIcon
          message="承载不足 · 无法启动"
          description="请返回 Step 3 调整 (减少目标 / 增加槽位 / 拉长时间)"
        />
      )}
      {safety?.status === SafetyStatus.Yellow && (
        <Alert
          type="warning"
          showIcon
          message="承载偏紧"
          description="可以启动, 但可能有部分对象延到下次发送"
        />
      )}
    </Space>
  );
}
