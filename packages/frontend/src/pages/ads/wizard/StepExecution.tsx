import { useEffect, useMemo, useState } from 'react';
import { Alert, Card, Checkbox, Progress, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import { ExclamationCircleFilled } from '@ant-design/icons';
import {
  campaignsApi,
  ExecutionMode,
  SafetyStatus,
  ThrottleProfile,
  type ActiveSlot,
} from '@/lib/campaigns-api';
import { parseExtraPhones, useWizard } from './WizardContext';
import { useSafetyPreview } from './hooks/useSafetyPreview';
import { CardTitle, CardIcons, CARD_STYLE, SelectableCard, RecommendBadge } from './shared';

// 2026-04-24 · Step 3 · 执行方式 + 承载检测

export function StepExecution({
  onSafetyChange,
}: {
  onSafetyChange?: (s: ReturnType<typeof useSafetyPreview>['preview']) => void;
}) {
  const { draft, patch } = useWizard();
  const [allSlots, setAllSlots] = useState<ActiveSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);

  useEffect(() => {
    setLoadingSlots(true);
    void campaignsApi
      .allSlots()
      .then(setAllSlots)
      .finally(() => setLoadingSlots(false));
  }, []);

  // 选中的未成熟号数
  const selectedImmatureCount = useMemo(() => {
    if (draft.executionMode !== ExecutionMode.CustomSlots) return 0;
    const selectedSet = new Set(draft.customSlotIds);
    return allSlots.filter((s) => selectedSet.has(s.slotId) && !s.isMature).length;
  }, [draft.executionMode, draft.customSlotIds, allSlots]);

  const matureSlotCount = allSlots.filter((s) => s.isMature).length;

  const { preview, loading, error } = useSafetyPreview({
    enabled: true,
    schedule: draft.schedule,
    targets: {
      groupIds: draft.groupIds,
      extraPhones: parseExtraPhones(draft.extraPhonesRaw),
    },
    executionMode: draft.executionMode,
    customSlotIds: draft.customSlotIds,
    throttleProfile: draft.throttleProfile,
  });

  useEffect(() => {
    onSafetyChange?.(preview ?? null);
  }, [preview, onSafetyChange]);

  const safetyColor =
    preview?.status === SafetyStatus.Green
      ? '#52c41a'
      : preview?.status === SafetyStatus.Yellow
        ? '#fa8c16'
        : '#f5222d';

  const safetyLabel =
    preview?.status === SafetyStatus.Green
      ? '正常'
      : preview?.status === SafetyStatus.Yellow
        ? '偏紧'
        : '风险';

  const safetyPct = preview ? Math.min(100, Math.round(preview.rate * 100)) : 0;

  // ── 节奏档位 meta ───────────────────────────────────────────
  const throttleOptions: Array<{
    value: ThrottleProfile;
    label: string;
    desc: string;
    recommend?: boolean;
  }> = [
    {
      value: ThrottleProfile.Conservative,
      label: '保守',
      desc: '每号每天 20 条 · 3 时段分发',
      recommend: true,
    },
    {
      value: ThrottleProfile.Balanced,
      label: '平衡',
      desc: '每号每天 30 条 · 3 时段分发',
    },
    {
      value: ThrottleProfile.Aggressive,
      label: '投放',
      desc: '每号每天 40 条 · 2 时段',
    },
  ];

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      {/* 账号来源 */}
      <Card size="small" style={CARD_STYLE} title={<CardTitle icon={CardIcons.executor}>账号来源</CardTitle>}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <SelectableCard
            active={draft.executionMode === ExecutionMode.Smart}
            onClick={() => patch({ executionMode: ExecutionMode.Smart })}
          >
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>系统智能安排</span>
              <RecommendBadge />
            </div>
            <div style={{ color: '#8c8c8c', fontSize: 12, marginTop: 4 }}>
              自动调用 成熟营运号 · 自动分配对象 · 自动打散时段 · 自动跳过异常账号
            </div>
          </SelectableCard>

          <SelectableCard
            active={draft.executionMode === ExecutionMode.CustomSlots}
            onClick={() => patch({ executionMode: ExecutionMode.CustomSlots })}
          >
            <div style={{ fontWeight: 600, fontSize: 14 }}>自定义槽位</div>
            <div style={{ color: '#8c8c8c', fontSize: 12, marginTop: 4 }}>
              自定义不关闭智能调度 · 风险管控和异常保护仍然启用
            </div>
          </SelectableCard>
        </Space>

        {draft.executionMode === ExecutionMode.CustomSlots && (
          <div style={{ marginTop: 16 }}>
            {loadingSlots ? (
              <Spin />
            ) : allSlots.length === 0 ? (
              <Alert
                type="warning"
                showIcon
                message="当前没有可用号"
                description="请先到 账号槽位 绑定账号"
              />
            ) : (
              <>
                <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                  共 {allSlots.length} 个账号 · 其中成熟号 <b style={{ color: '#25d366' }}>{matureSlotCount}</b> 个
                </Typography.Text>
                <Checkbox.Group
                  style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}
                  value={draft.customSlotIds}
                  onChange={(v) => patch({ customSlotIds: v as number[] })}
                >
                  {allSlots.map((s) => (
                    <Tooltip
                      key={s.slotId}
                      title={
                        s.isMature
                          ? `成熟营运号 · Phase 3 · 可安全使用`
                          : `未成熟 (Phase ${s.currentPhase ?? 0} · Day ${s.currentDay ?? 0}/14) · 强制使用会提高封号风险`
                      }
                    >
                      <div
                        style={{
                          border: s.isMature ? '1px solid #b7eb8f' : '1px solid #ffccc7',
                          borderRadius: 6,
                          padding: '6px 10px',
                          background: s.isMature ? '#f6ffed' : '#fff1f0',
                        }}
                      >
                        <Checkbox value={s.slotId}>
                          <span style={{ fontWeight: 500 }}>#{s.slotIndex}</span>
                          {s.isMature ? (
                            <Tag color="green" style={{ marginLeft: 6, marginRight: 0, fontSize: 11 }}>
                              成熟
                            </Tag>
                          ) : (
                            <Tag color="orange" style={{ marginLeft: 6, marginRight: 0, fontSize: 11 }}>
                              养号中 D{s.currentDay ?? 0}
                            </Tag>
                          )}
                        </Checkbox>
                      </div>
                    </Tooltip>
                  ))}
                </Checkbox.Group>

                {/* 选中未成熟号时的风险警告 */}
                {selectedImmatureCount > 0 && (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginTop: 12 }}
                    message={`⚠ 已选 ${selectedImmatureCount} 个未成熟号 · 封号风险偏高`}
                    description={
                      <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                        未成熟号 (养号未满 14 天) 被 WhatsApp 风控系统关注概率高. 强制使用可能导致:
                        <ul style={{ margin: '6px 0 0 0', paddingLeft: 20 }}>
                          <li>该号被限流或暂时封禁</li>
                          <li>养号进度被打断 · 重新开始</li>
                          <li>IP 关联风险提高 (同 IP 其他号也受牵连)</li>
                        </ul>
                        <div style={{ marginTop: 6, color: '#8c8c8c' }}>
                          你清楚风险并决定继续 · 建议减少投放数量 / 拉长时间段 / 下次用成熟号
                        </div>
                      </div>
                    }
                  />
                )}
              </>
            )}
          </div>
        )}
      </Card>

      {/* 节奏档位 */}
      <Card size="small" style={CARD_STYLE} title={<CardTitle icon={CardIcons.throttle}>节奏档位</CardTitle>}>
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          {throttleOptions.map((opt) => (
            <SelectableCard
              key={opt.value}
              active={draft.throttleProfile === opt.value}
              onClick={() => patch({ throttleProfile: opt.value })}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{opt.label}</span>
                  {opt.recommend && <RecommendBadge />}
                </div>
                <span style={{ color: '#8c8c8c', fontSize: 12 }}>{opt.desc}</span>
              </div>
            </SelectableCard>
          ))}
        </Space>
      </Card>

      {/* 安全承载 */}
      <Card size="small" style={CARD_STYLE} title={<CardTitle icon={CardIcons.safety}>安全承载</CardTitle>}>
        {loading && !preview ? (
          <Spin />
        ) : error ? (
          <Alert type="error" showIcon message={error} />
        ) : preview ? (
          <Space direction="vertical" style={{ width: '100%' }} size={14}>
            {/* Progress bar + 状态标签 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Progress
                percent={safetyPct}
                strokeColor={safetyColor}
                trailColor="#f0f0f0"
                showInfo={false}
                style={{ flex: 1, margin: 0 }}
              />
              <span style={{ color: safetyColor, fontWeight: 600, minWidth: 36, fontSize: 13 }}>
                {safetyLabel}
              </span>
            </div>

            {/* 统计 */}
            <div style={{ fontSize: 13, color: '#333', lineHeight: 1.9 }}>
              <div>
                目标人数: <b>{preview.totalTargets}</b>
              </div>
              <div>
                可用成熟号: <b>{preview.eligibleSlots}</b> / 总 {preview.matureSlots}
              </div>
              <div>
                承载: <b>{preview.capacity}</b>{' '}
                <span style={{ color: '#999' }}>
                  (= {preview.eligibleSlots} × {preview.dailyCap} × {preview.days} 天)
                </span>
              </div>
            </div>

            {/* Alert */}
            <div
              style={{
                border:
                  preview.status === SafetyStatus.Red
                    ? '1px solid #ffccc7'
                    : preview.status === SafetyStatus.Yellow
                      ? '1px solid #ffe7ba'
                      : '1px solid #b7eb8f',
                background:
                  preview.status === SafetyStatus.Red
                    ? '#fff1f0'
                    : preview.status === SafetyStatus.Yellow
                      ? '#fff7e6'
                      : '#f6ffed',
                borderRadius: 6,
                padding: '12px 16px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <ExclamationCircleFilled style={{ color: safetyColor, fontSize: 16, marginTop: 2 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#333', fontSize: 13, fontWeight: 500 }}>{preview.message}</div>
                  {preview.status === SafetyStatus.Red && (
                    <div style={{ color: '#8c8c8c', fontSize: 12, marginTop: 6 }}>
                      建议: 增加执行账号 / 减少投放数量 / 拉长时间 (改每天或每周)
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Space>
        ) : null}
      </Card>
    </Space>
  );
}
