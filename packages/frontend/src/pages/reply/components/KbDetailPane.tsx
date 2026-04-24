// 2026-04-24 · KB 详情面板 · 上传 + FAQ + 保留实体 · 分 3 tab
import { useEffect, useState } from 'react';
import {
  App,
  Card,
  Input,
  Space,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import {
  AimOutlined,
  EditOutlined,
  FileTextOutlined,
  QuestionCircleOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  StarFilled,
  StarOutlined,
} from '@ant-design/icons';
import {
  kbApi,
  type KbStats,
  type KnowledgeBase,
} from '@/lib/intelligent-reply-api';
import { extractErrorMessage } from '@/lib/api';
import { KbSourcesTab } from './KbSourcesTab';
import { KbFaqTab } from './KbFaqTab';
import { KbProtectedTab } from './KbProtectedTab';

const BRAND = '#25d366';
const BRAND_SOFT = '#f0faf4';
const CARD_STYLE = {
  boxShadow: '0 2px 10px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)',
  borderRadius: 10,
  border: '1px solid #eaeaea',
};

interface Props {
  kb: KnowledgeBase;
  stats?: KbStats;
  onChange: () => void;
  isDefault: boolean;
  onSetDefault: () => void;
}

export function KbDetailPane({ kb, stats, onChange, isDefault, onSetDefault }: Props) {
  const { message } = App.useApp();
  const [editingGoal, setEditingGoal] = useState(false);
  const [goal, setGoal] = useState(kb.goalPrompt ?? '');
  const [name, setName] = useState(kb.name);
  const [editingName, setEditingName] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('sources');
  const [localStats, setLocalStats] = useState<KbStats | undefined>(stats);

  useEffect(() => {
    setGoal(kb.goalPrompt ?? '');
    setName(kb.name);
    setLocalStats(stats);
  }, [kb.id, kb.goalPrompt, kb.name, stats]);

  const refreshStats = async () => {
    try {
      const s = await kbApi.stats(kb.id);
      setLocalStats(s);
    } catch {
      // ignore
    }
  };

  const saveGoal = async () => {
    setSaving(true);
    try {
      await kbApi.update(kb.id, { goalPrompt: goal.trim() });
      message.success('目标已保存');
      setEditingGoal(false);
      onChange();
    } catch (err) {
      message.error(extractErrorMessage(err, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const saveName = async () => {
    if (!name.trim() || name.trim() === kb.name) {
      setEditingName(false);
      setName(kb.name);
      return;
    }
    setSaving(true);
    try {
      await kbApi.update(kb.id, { name: name.trim() });
      message.success('已保存');
      setEditingName(false);
      onChange();
    } catch (err) {
      message.error(extractErrorMessage(err, '保存失败'));
      setName(kb.name);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={CARD_STYLE} styles={{ body: { padding: 16 } }}>
      {/* 头部 · 名 + 目标 */}
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            {editingName ? (
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onPressEnter={saveName}
                onBlur={saveName}
                autoFocus
                style={{ maxWidth: 300, fontWeight: 600 }}
              />
            ) : (
              <Typography.Title
                level={4}
                style={{ margin: 0, cursor: 'pointer' }}
                onClick={() => setEditingName(true)}
              >
                {kb.name}
                <EditOutlined style={{ color: '#bbb', fontSize: 14, marginLeft: 8 }} />
              </Typography.Title>
            )}
            <span
              role="button"
              onClick={onSetDefault}
              style={{
                cursor: isDefault ? 'default' : 'pointer',
                color: isDefault ? '#faad14' : '#ccc',
                fontSize: 16,
              }}
              title={isDefault ? '当前默认' : '点击设为默认'}
            >
              {isDefault ? <StarFilled /> : <StarOutlined />}
            </span>
            {isDefault && <Tag color="warning">默认</Tag>}
          </div>

          {/* 业务目标 · 可编辑 */}
          <div
            style={{
              background: BRAND_SOFT,
              border: `1px solid ${BRAND}40`,
              borderRadius: 8,
              padding: '10px 12px',
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: '#666',
                marginBottom: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <AimOutlined style={{ color: BRAND }} />
              业务目标 (AI 回复时的终极目标 · 会被带入每次对话 prompt)
            </div>
            {editingGoal ? (
              <>
                <Input.TextArea
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  autoSize={{ minRows: 2, maxRows: 4 }}
                  maxLength={512}
                  showCount
                />
                <Space style={{ marginTop: 6 }}>
                  <a
                    onClick={saveGoal}
                    style={{ color: BRAND }}
                    role="button"
                  >
                    <SaveOutlined /> 保存
                  </a>
                  <a
                    onClick={() => {
                      setEditingGoal(false);
                      setGoal(kb.goalPrompt ?? '');
                    }}
                    style={{ color: '#999' }}
                    role="button"
                  >
                    取消
                  </a>
                  {saving && <span style={{ color: '#999', fontSize: 12 }}>保存中...</span>}
                </Space>
              </>
            ) : (
              <div
                onClick={() => setEditingGoal(true)}
                role="button"
                style={{
                  cursor: 'pointer',
                  fontSize: 14,
                  color: '#333',
                  lineHeight: 1.6,
                }}
              >
                {kb.goalPrompt || (
                  <Typography.Text type="secondary">
                    点击添加目标 · 例: "让客户预约 demo"
                  </Typography.Text>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 3 tab 内容 */}
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'sources',
              label: (
                <span>
                  <FileTextOutlined /> 文档 {localStats ? `(${localStats.sources})` : ''}
                </span>
              ),
              children: (
                <KbSourcesTab
                  kbId={kb.id}
                  onChanged={() => {
                    onChange();
                    void refreshStats();
                  }}
                />
              ),
            },
            {
              key: 'faq',
              label: (
                <span>
                  <QuestionCircleOutlined /> FAQ{' '}
                  {localStats && (
                    <>
                      ({localStats.faqEnabled}
                      {localStats.faqDraft > 0 && (
                        <span style={{ color: '#fa8c16' }}> · {localStats.faqDraft} 待审</span>
                      )}
                      )
                    </>
                  )}
                </span>
              ),
              children: (
                <KbFaqTab
                  kbId={kb.id}
                  onChanged={() => {
                    onChange();
                    void refreshStats();
                  }}
                />
              ),
            },
            {
              key: 'protected',
              label: (
                <span>
                  <SafetyCertificateOutlined /> 保留实体{' '}
                  {localStats ? `(${localStats.entities})` : ''}
                </span>
              ),
              children: (
                <KbProtectedTab
                  kbId={kb.id}
                  onChanged={() => {
                    onChange();
                    void refreshStats();
                  }}
                />
              ),
            },
          ]}
        />
      </Space>
    </Card>
  );
}
