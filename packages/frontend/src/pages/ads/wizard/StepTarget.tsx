import { useEffect, useState } from 'react';
import {
  Alert,
  Card,
  Checkbox,
  DatePicker,
  Form,
  Input,
  Select,
  Space,
  TimePicker,
  Typography,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { customerGroupsApi, type CustomerGroup, type CampaignSchedule } from '@/lib/campaigns-api';
import { parseExtraPhones, useWizard } from './WizardContext';
import { CardTitle, CardIcons, CARD_STYLE, TimeModePicker } from './shared';

const WEEK_OPTIONS = [
  { label: '周日', value: 0 },
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
];

// 2026-04-23 · Step 1 · 时间 + 对象
export function StepTarget() {
  const { draft, patch } = useWizard();
  const [groups, setGroups] = useState<CustomerGroup[]>([]);
  const extraCount = parseExtraPhones(draft.extraPhonesRaw).length;

  useEffect(() => {
    void customerGroupsApi.list().then(setGroups).catch(() => undefined);
  }, []);

  const updateSchedule = (next: Partial<CampaignSchedule>): void => {
    patch({ schedule: { ...draft.schedule, ...next } as CampaignSchedule });
  };

  const setMode = (mode: CampaignSchedule['mode']): void => {
    if (mode === 'immediate') patch({ schedule: { mode: 'immediate' } });
    else if (mode === 'once')
      patch({
        schedule: { mode: 'once', fireAt: dayjs().add(1, 'hour').toISOString() },
      });
    else if (mode === 'daily')
      patch({
        schedule: {
          mode: 'daily',
          time: '20:00',
          startDate: dayjs().format('YYYY-MM-DD'),
          endDate: null,
        },
      });
    else
      patch({
        schedule: {
          mode: 'weekly',
          days: [1, 3, 5],
          time: '20:00',
          startDate: dayjs().format('YYYY-MM-DD'),
          endDate: null,
        },
      });
  };

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <Card size="small" style={CARD_STYLE} title={<CardTitle icon={CardIcons.name}>投放名称</CardTitle>}>
        <Input
          placeholder="例如: 618 促销投放"
          maxLength={50}
          showCount
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </Card>

      <Card size="small" style={CARD_STYLE} title={<CardTitle icon={CardIcons.time}>发送时间</CardTitle>}>
        <TimeModePicker
          value={draft.schedule.mode}
          onChange={(v) => setMode(v)}
        />

        {draft.schedule.mode !== 'immediate' && (
          <Form
            layout="horizontal"
            labelCol={{ flex: '110px' }}
            wrapperCol={{ flex: 1 }}
            labelAlign="left"
            colon={false}
            style={{ marginTop: 16 }}
          >
            {draft.schedule.mode === 'once' && (
              <Form.Item label="执行时间" style={{ marginBottom: 0 }}>
                <DatePicker
                  showTime={{ format: 'HH:mm' }}
                  format="YYYY-MM-DD HH:mm"
                  placeholder="选择日期时间"
                  value={
                    'fireAt' in draft.schedule && draft.schedule.fireAt
                      ? dayjs(draft.schedule.fireAt)
                      : null
                  }
                  onChange={(d: Dayjs | null) =>
                    updateSchedule({ fireAt: d ? d.toISOString() : undefined })
                  }
                />
              </Form.Item>
            )}

            {draft.schedule.mode === 'daily' && (
              <>
                <Form.Item label="执行时间">
                  <TimePicker
                    format="HH:mm"
                    placeholder="选择时间"
                    value={
                      'time' in draft.schedule && draft.schedule.time
                        ? dayjs(draft.schedule.time, 'HH:mm')
                        : null
                    }
                    onChange={(d: Dayjs | null) =>
                      updateSchedule({ time: d ? d.format('HH:mm') : undefined })
                    }
                  />
                </Form.Item>
                <Form.Item label="开始日期">
                  <DatePicker
                    placeholder="选择日期"
                    value={
                      'startDate' in draft.schedule && draft.schedule.startDate
                        ? dayjs(draft.schedule.startDate)
                        : null
                    }
                    onChange={(d: Dayjs | null) =>
                      updateSchedule({ startDate: d ? d.format('YYYY-MM-DD') : undefined })
                    }
                  />
                </Form.Item>
                <Form.Item label="结束日期 (可选)" style={{ marginBottom: 0 }}>
                  <DatePicker
                    placeholder="不填则长期"
                    value={
                      'endDate' in draft.schedule && draft.schedule.endDate
                        ? dayjs(draft.schedule.endDate)
                        : null
                    }
                    onChange={(d: Dayjs | null) =>
                      updateSchedule({ endDate: d ? d.format('YYYY-MM-DD') : null })
                    }
                  />
                </Form.Item>
              </>
            )}

            {draft.schedule.mode === 'weekly' && (
              <>
                <Form.Item label="星期 (可多选)">
                  <Checkbox.Group
                    options={WEEK_OPTIONS}
                    value={'days' in draft.schedule ? draft.schedule.days ?? [] : []}
                    onChange={(v) => updateSchedule({ days: v as number[] })}
                  />
                </Form.Item>
                <Form.Item label="执行时间">
                  <TimePicker
                    format="HH:mm"
                    placeholder="选择时间"
                    value={
                      'time' in draft.schedule && draft.schedule.time
                        ? dayjs(draft.schedule.time, 'HH:mm')
                        : null
                    }
                    onChange={(d: Dayjs | null) =>
                      updateSchedule({ time: d ? d.format('HH:mm') : undefined })
                    }
                  />
                </Form.Item>
                <Form.Item label="开始日期">
                  <DatePicker
                    placeholder="选择日期"
                    value={
                      'startDate' in draft.schedule && draft.schedule.startDate
                        ? dayjs(draft.schedule.startDate)
                        : null
                    }
                    onChange={(d: Dayjs | null) =>
                      updateSchedule({ startDate: d ? d.format('YYYY-MM-DD') : undefined })
                    }
                  />
                </Form.Item>
                <Form.Item label="结束日期 (可选)" style={{ marginBottom: 0 }}>
                  <DatePicker
                    placeholder="不填则长期"
                    value={
                      'endDate' in draft.schedule && draft.schedule.endDate
                        ? dayjs(draft.schedule.endDate)
                        : null
                    }
                    onChange={(d: Dayjs | null) =>
                      updateSchedule({ endDate: d ? d.format('YYYY-MM-DD') : null })
                    }
                  />
                </Form.Item>
              </>
            )}
          </Form>
        )}
      </Card>

      <Card size="small" style={CARD_STYLE} title={<CardTitle icon={CardIcons.target}>目标号码</CardTitle>}>
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <Form.Item label="选择客户群 (可多选)" style={{ marginBottom: 0 }}>
            <Select
              mode="multiple"
              value={draft.groupIds}
              onChange={(v) => patch({ groupIds: v })}
              options={groups.map((g) => ({
                label: `${g.name} · ${g.memberCount} 人`,
                value: g.id,
              }))}
              placeholder="从已有客户群中选择"
              allowClear
              notFoundContent="还没有客户群 · 请先到 资源管理 → 客户群 创建"
            />
          </Form.Item>

          <Form.Item
            label="手动补充号码 (可选)"
            style={{ marginBottom: 0 }}
            extra={
              draft.extraPhonesRaw.trim()
                ? (
                    <span style={{ color: extraCount > 0 ? '#25d366' : '#bbb' }}>
                      已识别 {extraCount} 个有效号码 · 与客户群自动去重
                    </span>
                  )
                : undefined
            }
          >
            <Input.TextArea
              rows={5}
              maxLength={2000}
              showCount
              value={draft.extraPhonesRaw}
              onChange={(e) => patch({ extraPhonesRaw: e.target.value })}
              placeholder={'一行一个号码, 支持逗号/空格分隔'}
            />
          </Form.Item>
        </Space>
      </Card>

      {draft.groupIds.length === 0 && extraCount === 0 && (
        <Alert type="warning" showIcon message="请至少选择一个客户群或填入手动号码, 否则无法继续" />
      )}
      <Typography.Text type="secondary" style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: '#8c8c8c' }}>ⓘ</span>
        说明: 系统会在你的 成熟营运号 (完成 14 天养号) 之间均匀分配, 按节流档位打散时段. 暂只支持马来格式号码.
      </Typography.Text>
    </Space>
  );
}
