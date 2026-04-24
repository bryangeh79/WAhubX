// 2026-04-24 · 高级设置 (默认藏 · 懒得动租户不动)
import { useState } from 'react';
import {
  App,
  Button,
  Card,
  Input,
  InputNumber,
  Space,
  Switch,
  Tag,
  TimePicker,
  Tooltip,
  Typography,
} from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { replySettingsApi, type TenantReplySettings } from '@/lib/intelligent-reply-api';
import { extractErrorMessage } from '@/lib/api';

const BRAND = '#25d366';

interface Props {
  settings: TenantReplySettings;
  onChange: (next: TenantReplySettings) => void;
}

export function ReplyAdvancedSettings({ settings, onChange }: Props) {
  const { message } = App.useApp();
  const [saving, setSaving] = useState(false);
  const [newBlacklist, setNewBlacklist] = useState('');
  const [newHandoff, setNewHandoff] = useState('');

  const save = async (patch: Partial<TenantReplySettings>) => {
    setSaving(true);
    try {
      const updated = await replySettingsApi.update(patch);
      onChange(updated);
      message.success('已保存');
    } catch (err) {
      message.error(extractErrorMessage(err, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {/* 每日上限 */}
      <Card
        size="small"
        title={
          <Space>
            <span>每日 AI 运行时上限</span>
            <Tooltip title="超出此数 · 当天不再自动回复 · 避免 AI 费用失控">
              <InfoCircleOutlined style={{ color: '#bbb' }} />
            </Tooltip>
          </Space>
        }
      >
        <Space>
          <InputNumber
            min={10}
            max={10000}
            step={50}
            value={settings.dailyAiReplyLimit}
            onChange={(v) => v != null && save({ dailyAiReplyLimit: Number(v) })}
            disabled={saving}
            addonAfter="次/天"
            style={{ width: 180 }}
          />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            默认 200 次 · 超 150 次会提醒
          </Typography.Text>
        </Space>
      </Card>

      {/* 静默时段 */}
      <Card
        size="small"
        title={
          <Space>
            <span>夜间静默</span>
            <Switch
              size="small"
              checked={settings.quietHoursEnabled}
              onChange={(checked) => save({ quietHoursEnabled: checked })}
              disabled={saving}
            />
          </Space>
        }
      >
        {settings.quietHoursEnabled ? (
          <Space>
            <TimePicker
              format="HH:mm"
              value={dayjs(`2024-01-01 ${settings.quietHoursStart}`)}
              onChange={(v) => v && save({ quietHoursStart: v.format('HH:mm') })}
              disabled={saving}
            />
            <span>至</span>
            <TimePicker
              format="HH:mm"
              value={dayjs(`2024-01-01 ${settings.quietHoursEnd}`)}
              onChange={(v) => v && save({ quietHoursEnd: v.format('HH:mm') })}
              disabled={saving}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              这段时间内不自动回复 · 推荐 22:00-08:00 (租户本地时区)
            </Typography.Text>
          </Space>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            当前 24 小时都会自动回复 · 开启夜间静默可以更像真人
          </Typography.Text>
        )}
      </Card>

      {/* 黑名单词 */}
      <Card
        size="small"
        title={
          <Space>
            <span>禁止话题 (AI 不会谈)</span>
            <Tooltip title="例: 报价 · 竞品 · 承诺时效. AI 回复里若含这些词会被过滤">
              <InfoCircleOutlined style={{ color: '#bbb' }} />
            </Tooltip>
          </Space>
        }
      >
        <Space wrap style={{ marginBottom: 8 }}>
          {settings.blacklistKeywords.map((kw, i) => (
            <Tag
              key={i}
              closable
              onClose={() => save({
                blacklistKeywords: settings.blacklistKeywords.filter((_, idx) => idx !== i),
              })}
            >
              {kw}
            </Tag>
          ))}
          {settings.blacklistKeywords.length === 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              还没有禁词
            </Typography.Text>
          )}
        </Space>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder="输入一个禁词 · 例: 报价"
            value={newBlacklist}
            onChange={(e) => setNewBlacklist(e.target.value)}
            onPressEnter={() => {
              const v = newBlacklist.trim();
              if (!v) return;
              if (settings.blacklistKeywords.includes(v)) return;
              save({ blacklistKeywords: [...settings.blacklistKeywords, v] });
              setNewBlacklist('');
            }}
          />
          <Button
            type="primary"
            style={{ background: BRAND, borderColor: BRAND }}
            onClick={() => {
              const v = newBlacklist.trim();
              if (!v) return;
              if (settings.blacklistKeywords.includes(v)) return;
              save({ blacklistKeywords: [...settings.blacklistKeywords, v] });
              setNewBlacklist('');
            }}
          >
            添加
          </Button>
        </Space.Compact>
      </Card>

      {/* 自定义转人工关键词 */}
      <Card
        size="small"
        title={
          <Space>
            <span>立即转人工关键词 (自定义)</span>
            <Tooltip title="客户消息里出现这些词, 立即停止 AI · 推送到人工接管">
              <InfoCircleOutlined style={{ color: '#bbb' }} />
            </Tooltip>
          </Space>
        }
      >
        <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
          系统自带 20+ 基础词 (投诉/退款/律师/报警...) · 这里只填你业务专属词
        </Typography.Text>
        <Space wrap style={{ marginBottom: 8 }}>
          {settings.customHandoffKeywords.map((kw, i) => (
            <Tag
              key={i}
              color="orange"
              closable
              onClose={() => save({
                customHandoffKeywords: settings.customHandoffKeywords.filter((_, idx) => idx !== i),
              })}
            >
              {kw}
            </Tag>
          ))}
          {settings.customHandoffKeywords.length === 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              只用系统自带词
            </Typography.Text>
          )}
        </Space>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder="添加一个 · 例: 见老板"
            value={newHandoff}
            onChange={(e) => setNewHandoff(e.target.value)}
            onPressEnter={() => {
              const v = newHandoff.trim();
              if (!v) return;
              if (settings.customHandoffKeywords.includes(v)) return;
              save({ customHandoffKeywords: [...settings.customHandoffKeywords, v] });
              setNewHandoff('');
            }}
          />
          <Button
            onClick={() => {
              const v = newHandoff.trim();
              if (!v) return;
              if (settings.customHandoffKeywords.includes(v)) return;
              save({ customHandoffKeywords: [...settings.customHandoffKeywords, v] });
              setNewHandoff('');
            }}
          >
            添加
          </Button>
        </Space.Compact>
      </Card>
    </Space>
  );
}
