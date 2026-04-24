import { useEffect, useMemo, useState } from 'react';
import { App, Button, Col, Modal, Row, Space } from 'antd';
import { ArrowRightOutlined } from '@ant-design/icons';
import {
  AdStrategy,
  campaignsApi,
  ExecutionMode,
  OpeningStrategy,
  SafetyStatus,
  type SafetyPreview,
} from '@/lib/campaigns-api';
import { extractErrorMessage } from '@/lib/api';
import { WizardProvider, parseExtraPhones, useWizard } from './WizardContext';
import { loadDraft, clearDraft, useAutoSaveDraft } from './hooks/useWizardDraft';
import { StepTarget } from './StepTarget';
import { StepContent } from './StepContent';
import { StepExecution } from './StepExecution';
import { StepConfirm } from './StepConfirm';
import { SummaryPanel } from './SummaryPanel';
import { CustomSteps, BRAND } from './shared';

const STEP_ITEMS = [
  { title: '投放对象', subtitle: '设置目标对象' },
  { title: '广告内容', subtitle: '配置广告素材' },
  { title: '执行方式', subtitle: '设置执行策略' },
  { title: '确认启动', subtitle: '确认并启动' },
];

const NEXT_LABEL: Record<number, string> = {
  0: '继续: 设置广告内容',
  1: '继续: 设置执行方式',
  2: '继续: 确认启动',
};

// 2026-04-23 · 广告投放向导 · 4 步 · 全屏 Modal · plan §F

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function WizardBody({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const { message } = App.useApp();
  const { draft, reset } = useWizard();
  useAutoSaveDraft(draft);

  const [step, setStep] = useState(0);
  const [safety, setSafety] = useState<SafetyPreview | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Step 1/2/3 校验
  const extraPhones = useMemo(() => parseExtraPhones(draft.extraPhonesRaw), [draft.extraPhonesRaw]);

  const canNextFromStep = (s: number): string | null => {
    if (s === 0) {
      if (!draft.name.trim()) return '请填写投放名称';
      if (draft.groupIds.length === 0 && extraPhones.length === 0) return '至少选一个客户群或填手动号码';
      if (draft.schedule.mode === 'once' && !('fireAt' in draft.schedule && draft.schedule.fireAt))
        return '单次执行必须选一个日期时间';
      if (draft.schedule.mode === 'daily' && !('time' in draft.schedule && draft.schedule.time))
        return '每天重复必须设时间';
      if (draft.schedule.mode === 'weekly') {
        const days = 'days' in draft.schedule ? draft.schedule.days ?? [] : [];
        if (days.length === 0) return '每周重复必须选至少一个星期';
        if (!('time' in draft.schedule && draft.schedule.time)) return '必须选时间';
      }
    }
    if (s === 1) {
      if (draft.adIds.length === 0) return '至少选一条广告';
      if (draft.adStrategy === AdStrategy.Single && draft.adIds.length !== 1)
        return '单一广告模式只能选 1 条';
      if (draft.adStrategy === AdStrategy.Rotation && draft.adIds.length < 2)
        return '多广告轮换至少选 2 条';
      if (draft.openingStrategy === OpeningStrategy.Fixed && draft.openingIds.length !== 1)
        return '固定开场必须选 1 条';
    }
    if (s === 2) {
      if (draft.executionMode === ExecutionMode.CustomSlots && draft.customSlotIds.length === 0)
        return '自定义槽位模式必须选至少 1 个槽位';
      if (safety && safety.status === SafetyStatus.Red) return '安全承载不足 · 无法继续';
    }
    return null;
  };

  const onNext = () => {
    const err = canNextFromStep(step);
    if (err) {
      message.warning(err);
      return;
    }
    setStep((s) => s + 1);
  };

  const onPrev = () => {
    setStep((s) => Math.max(0, s - 1));
  };

  const onSubmit = async (startNow: boolean) => {
    setSubmitting(true);
    try {
      await campaignsApi.create({
        name: draft.name,
        schedule: draft.schedule,
        targets: {
          groupIds: draft.groupIds,
          extraPhones,
        },
        adStrategy: draft.adStrategy,
        adIds: draft.adIds,
        openingStrategy: draft.openingStrategy,
        openingIds: draft.openingStrategy === OpeningStrategy.None ? [] : draft.openingIds,
        executionMode: draft.executionMode,
        customSlotIds:
          draft.executionMode === ExecutionMode.CustomSlots ? draft.customSlotIds : undefined,
        throttleProfile: draft.throttleProfile,
        startNow,
      });
      message.success(startNow ? '投放已启动' : '已保存为草稿');
      clearDraft();
      reset();
      setStep(0);
      onSuccess();
    } catch (err) {
      message.error(extractErrorMessage(err, '创建失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const stepContent =
    step === 0 ? (
      <StepTarget />
    ) : step === 1 ? (
      <StepContent />
    ) : step === 2 ? (
      <StepExecution onSafetyChange={setSafety} />
    ) : (
      <StepConfirm safety={safety} />
    );

  return (
    <div>
      <CustomSteps current={step} items={STEP_ITEMS} />

      <Row gutter={24}>
        <Col span={16}>{stepContent}</Col>
        <Col span={8}>
          <SummaryPanel safety={safety} />
        </Col>
      </Row>

      <div
        style={{
          marginTop: 24,
          paddingTop: 16,
          borderTop: '1px solid #f0f0f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Space>
          <Button onClick={onClose} disabled={submitting}>
            取消
          </Button>
          {step > 0 && step < 3 && (
            <Button onClick={onPrev} disabled={submitting}>
              上一步
            </Button>
          )}
          {step === 3 && (
            <Button onClick={onPrev} disabled={submitting}>
              返回修改
            </Button>
          )}
        </Space>
        <Space>
          {step < 3 && (
            <Button
              type="primary"
              size="large"
              onClick={onNext}
              style={{ background: BRAND, borderColor: BRAND, fontWeight: 500 }}
            >
              {NEXT_LABEL[step]} <ArrowRightOutlined />
            </Button>
          )}
          {step === 3 && (
            <>
              <Button onClick={() => onSubmit(false)} loading={submitting}>
                保存草稿
              </Button>
              <Button
                type="primary"
                size="large"
                style={{ background: BRAND, borderColor: BRAND, fontWeight: 500 }}
                onClick={() => onSubmit(true)}
                loading={submitting}
                disabled={safety?.status === SafetyStatus.Red}
              >
                开始投放
              </Button>
            </>
          )}
        </Space>
      </div>
    </div>
  );
}

export function CreateCampaignModal({ open, onClose, onSuccess }: Props) {
  const [initial, setInitial] = useState(() => loadDraft());

  useEffect(() => {
    if (open) setInitial(loadDraft());
  }, [open]);

  return (
    <Modal
      title={<span style={{ fontSize: 17, fontWeight: 600 }}>新建广告投放</span>}
      open={open}
      onCancel={onClose}
      footer={null}
      width="90vw"
      style={{ top: 20, maxWidth: 1280 }}
      destroyOnHidden
    >
      <WizardProvider initial={initial}>
        <WizardBody onClose={onClose} onSuccess={onSuccess} />
      </WizardProvider>
    </Modal>
  );
}
