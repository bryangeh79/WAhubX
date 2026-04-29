// 2026-04-29 · P0-CS-3 · 账号体检 modal
//
// 默认选客服号 · 可切换到指定 slot
// 显示中文总结 + 建议动作 · 可展开 12 项技术 check 详情

import { useEffect, useMemo, useState } from 'react';
import { App, Alert, Button, Collapse, Modal, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import { MedicineBoxOutlined } from '@ant-design/icons';
import { slotHealthApi, extractErrorMessage } from '@/lib/api';
import {
  STATUS_COLOR,
  OVERALL_COLOR,
  OVERALL_LABEL,
  type CheckupResult,
  type CheckStatus,
  type HealthCheck,
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
}

const STATUS_LABEL: Record<CheckStatus, string> = {
  pass: '通过',
  warn: '警告',
  fail: '失败',
  unknown: '未知',
};

export function CheckupModal({ open, onClose, slots, defaultSlotId }: Props) {
  const { message } = App.useApp();
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CheckupResult | null>(null);

  // 默认选客服号 (active + customer_service)
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

  const runCheckup = async () => {
    if (!selectedSlotId) {
      message.warning('请先选择一个账号');
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const r = await slotHealthApi.checkup(selectedSlotId);
      setResult(r);
    } catch (err) {
      message.error(extractErrorMessage(err, '体检失败'));
    } finally {
      setLoading(false);
    }
  };

  const checkColumns = [
    {
      title: '检查项',
      dataIndex: 'labelZh',
      key: 'labelZh',
      width: 160,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (s: CheckStatus) => <Tag color={STATUS_COLOR[s]}>{STATUS_LABEL[s]}</Tag>,
    },
    {
      title: '值',
      dataIndex: 'value',
      key: 'value',
      width: 140,
      render: (v: unknown) => (
        <Typography.Text style={{ fontSize: 12 }}>
          {v === null ? '—' : String(v)}
        </Typography.Text>
      ),
    },
    {
      title: '说明',
      dataIndex: 'messageZh',
      key: 'messageZh',
      render: (m: string) => <Typography.Text style={{ fontSize: 12 }}>{m}</Typography.Text>,
    },
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <Space>
          <MedicineBoxOutlined style={{ color: '#1677ff' }} />
          <span>账号体检</span>
        </Space>
      }
      footer={
        <Space>
          <Button onClick={onClose}>关闭</Button>
          <Button type="primary" onClick={runCheckup} loading={loading} disabled={!selectedSlotId}>
            {result ? '重新体检' : '开始体检'}
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

      {loading && (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin tip="正在体检 12 项..." />
        </div>
      )}

      {result && !loading && (
        <>
          <Alert
            type={OVERALL_COLOR[result.overallStatus]}
            showIcon
            message={
              <Space>
                <span>{`${OVERALL_LABEL[result.overallStatus]}`}</span>
                {result.phone && <Tag>{result.phone}</Tag>}
                {result.role === 'customer_service' && <Tag color="green">客服号</Tag>}
                {result.role === 'broadcast' && <Tag color="blue">广告号</Tag>}
              </Space>
            }
            description={
              <div style={{ whiteSpace: 'pre-line', fontSize: 13, lineHeight: 1.7, marginTop: 4 }}>
                {result.summaryZh}
                {result.recommendedActionZh && (
                  <div style={{ marginTop: 8, color: '#1677ff' }}>
                    💡 {result.recommendedActionZh}
                  </div>
                )}
              </div>
            }
            style={{ marginBottom: 12 }}
          />

          <Collapse
            size="small"
            items={[
              {
                key: 'checks',
                label: `技术详情 · ${result.checks.length} 项检查`,
                children: (
                  <Table<HealthCheck>
                    rowKey="key"
                    size="small"
                    pagination={false}
                    columns={checkColumns}
                    dataSource={result.checks}
                  />
                ),
              },
            ]}
          />

          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 11 }}>
            体检时间: {new Date(result.generatedAt).toLocaleString()}
          </Typography.Text>
        </>
      )}

      {!loading && !result && (
        <Alert
          type="info"
          message="提示"
          description="点击「开始体检」检查账号 12 项指标 (runtime / 心跳 / WA 状态 / watcher / 失败 task / 锁 / 隔离等). 仅诊断, 不动 runtime."
        />
      )}
    </Modal>
  );
}
