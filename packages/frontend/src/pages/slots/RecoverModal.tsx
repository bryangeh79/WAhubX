// 2026-04-29 · P0-CS-3 · 一键恢复 modal
//
// 默认选客服号 · 二次确认 · 显示 attempted/skipped 动作
// QR 状态只提示扫码 · 不清 session/profile/cookie

import { useEffect, useMemo, useState } from 'react';
import { App, Alert, Button, Modal, Result, Select, Space, Spin, Tag, Typography } from 'antd';
import { ThunderboltOutlined, CheckCircleOutlined, ExclamationCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { slotHealthApi, extractErrorMessage } from '@/lib/api';
import {
  STATUS_COLOR,
  RECOVER_RESULT_LABEL,
  type RecoverResult,
  type CheckStatus,
} from '@/lib/slot-health-types';

interface SlotPickerItem {
  id: number;
  slotIndex: number;
  role?: 'broadcast' | 'customer_service';
  phoneNumber: string | null;
  status: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  slots: SlotPickerItem[];
  defaultSlotId?: number | null;
  onRecovered?: () => void; // 成功后让父页面 reload
}

const STATUS_LABEL: Record<CheckStatus, string> = {
  pass: '通过',
  warn: '警告',
  fail: '失败',
  unknown: '未知',
};

const STATUS_ICON: Record<CheckStatus, React.ReactNode> = {
  pass: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
  warn: <ExclamationCircleOutlined style={{ color: '#faad14' }} />,
  fail: <CloseCircleOutlined style={{ color: '#cf1322' }} />,
  unknown: <ExclamationCircleOutlined style={{ color: '#999' }} />,
};

export function RecoverModal({ open, onClose, slots, defaultSlotId, onRecovered }: Props) {
  const { message, modal } = App.useApp();
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RecoverResult | null>(null);

  useEffect(() => {
    if (!open) return;
    const cs = slots.find((s) => s.role === 'customer_service' && s.status === 'active');
    setSelectedSlotId(defaultSlotId ?? cs?.id ?? slots.find((s) => s.status === 'active')?.id ?? null);
    setResult(null);
  }, [open, slots, defaultSlotId]);

  const slotOptions = useMemo(() => {
    return slots
      .filter((s) => s.status === 'active' && s.phoneNumber != null)
      .map((s) => ({
        value: s.id,
        label: (
          <Space size={6}>
            <span>#{s.slotIndex}</span>
            <span>{s.phoneNumber}</span>
            {s.role === 'customer_service' ? (
              <Tag color="green">客服号</Tag>
            ) : (
              <Tag color="blue">广告号</Tag>
            )}
          </Space>
        ),
      }));
  }, [slots]);

  const selectedSlot = slots.find((s) => s.id === selectedSlotId);
  const isCs = selectedSlot?.role === 'customer_service';

  const runRecover = async () => {
    if (!selectedSlotId || !selectedSlot) {
      message.warning('请先选择一个账号');
      return;
    }
    // 二次确认 modal
    const confirmText = `确认恢复 #${selectedSlot.slotIndex} ${selectedSlot.phoneNumber} 吗?\n\n本次只恢复此账号, 不会批量处理其他账号.${isCs ? '\n\n(若需要重启 runtime, 该号约 10-20 秒不可用)' : ''}`;
    modal.confirm({
      title: '确认恢复',
      content: <div style={{ whiteSpace: 'pre-line' }}>{confirmText}</div>,
      okText: '确认恢复',
      cancelText: '取消',
      okButtonProps: { type: 'primary', danger: false },
      onOk: async () => {
        setLoading(true);
        setResult(null);
        try {
          const r = await slotHealthApi.recover(selectedSlotId);
          setResult(r);
          if (r.result === 'success') {
            message.success('恢复成功');
          } else if (r.result === 'partial') {
            message.warning('部分恢复 · 详见结果');
          } else if (r.result === 'need_scan') {
            message.info('需要扫码 · 请去接管页扫码');
          } else {
            message.error('恢复失败 · 详见结果');
          }
          onRecovered?.();
        } catch (err) {
          message.error(extractErrorMessage(err, '恢复失败'));
        } finally {
          setLoading(false);
        }
      },
    });
  };

  const resultStatus: 'success' | 'info' | 'warning' | 'error' =
    result?.result === 'success' ? 'success' :
    result?.result === 'need_scan' ? 'info' :
    result?.result === 'partial' ? 'warning' : 'error';

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <Space>
          <ThunderboltOutlined style={{ color: '#fa8c16' }} />
          <span>一键恢复</span>
        </Space>
      }
      footer={
        <Space>
          <Button onClick={onClose}>关闭</Button>
          <Button type="primary" onClick={runRecover} loading={loading} disabled={!selectedSlotId}>
            {result ? '再次恢复' : '开始恢复'}
          </Button>
        </Space>
      }
      width={780}
      destroyOnClose
    >
      <div style={{ marginBottom: 12 }}>
        <Typography.Text strong>选择账号: </Typography.Text>
        <Select
          style={{ width: 360 }}
          value={selectedSlotId}
          onChange={setSelectedSlotId}
          options={slotOptions}
          placeholder="请选择账号"
        />
        <Typography.Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>
          默认选中客服号
        </Typography.Text>
      </div>

      <Alert
        type="warning"
        showIcon
        message="本次只恢复当前选中账号"
        description="不会批量处理全部账号. P0 不会自动: 释放 takeover 锁 / 解除 quarantine / 重置 failed task / 清 session 或 cookie."
        style={{ marginBottom: 12 }}
      />

      {isCs && (
        <Alert
          type="warning"
          showIcon
          message="客服号注意"
          description="若需要重启 runtime, 恢复期间约 10-20 秒 AI 客服可能暂停, 客户消息暂时无法自动回复."
          style={{ marginBottom: 12 }}
        />
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin tip="恢复中... 这可能需要 10-30 秒" />
        </div>
      )}

      {result && !loading && (
        <>
          <Result
            status={resultStatus}
            title={`恢复${RECOVER_RESULT_LABEL[result.result]}`}
            subTitle={result.summaryZh}
            style={{ padding: '16px 0' }}
          />

          {result.actionsAttempted.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <Typography.Text strong>已执行:</Typography.Text>
              <ul style={{ marginTop: 6, paddingLeft: 24 }}>
                {result.actionsAttempted.map((a, i) => (
                  <li key={i} style={{ fontSize: 13, lineHeight: 1.8 }}>
                    {STATUS_ICON[a.status]} <Tag color={STATUS_COLOR[a.status]}>{STATUS_LABEL[a.status]}</Tag>
                    {a.messageZh}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.actionsSkipped.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <Typography.Text strong>跳过:</Typography.Text>
              <ul style={{ marginTop: 6, paddingLeft: 24 }}>
                {result.actionsSkipped.map((a, i) => (
                  <li key={i} style={{ fontSize: 13, lineHeight: 1.8, color: '#666' }}>
                    ⚠️ <Typography.Text code>{a.key}</Typography.Text>: {a.reasonZh}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.needScan && (
            <Alert
              type="info"
              showIcon
              message="仍需处理: 重新扫码"
              description="请前往「人工接管」页面, 选中本账号, 用手机 WhatsApp 扫描 QR 完成登录."
              style={{ marginTop: 12 }}
            />
          )}

          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 11 }}>
            前后体检对比: {result.beforeDiagnose.overallStatus} → {result.afterDiagnose.overallStatus}
          </Typography.Text>
        </>
      )}

      {!loading && !result && (
        <Alert
          type="info"
          message="P0 恢复策略"
          description={
            <ul style={{ marginBottom: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.7 }}>
              <li>runtime 不在 → 启动</li>
              <li>runtime 假死 (心跳停 &gt; 180s) → 重启</li>
              <li>QR 状态 → 提示扫码 (不清 session)</li>
              <li>watcher 不健康 → 等 runtime 内 30s 自检 (不重启)</li>
              <li>已隔离/暂停/失败 task / takeover 锁卡住 → 仅报告</li>
            </ul>
          }
        />
      )}
    </Modal>
  );
}
