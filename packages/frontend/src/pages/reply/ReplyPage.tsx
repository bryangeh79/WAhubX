// 2026-04-24 · 智能客服 主页 · 3 步 UX
// 1. 选/建知识库 (默认自动建)
// 2. 上传产品介绍
// 3. 选模式 + 写目标 · 保存

import { useEffect, useMemo, useState } from 'react';
import {
  App,
  Alert,
  Button,
  Card,
  Space,
  Tabs,
  Typography,
} from 'antd';
import {
  BookOutlined,
  MessageOutlined,
  RobotOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import {
  kbApi,
  replySettingsApi,
  type KnowledgeBase,
  type TenantReplySettings,
} from '@/lib/intelligent-reply-api';
import { api, extractErrorMessage } from '@/lib/api';
import { useNavigate } from 'react-router-dom';
import { KnowledgeBasePanel } from './components/KnowledgeBasePanel';
import { ReplyModeCard } from './components/ReplyModeCard';
import { ReplyOverviewPanel } from './components/ReplyOverviewPanel';
import { ReplyAdvancedSettings } from './components/ReplyAdvancedSettings';
import { ReplySetupWizard } from './components/ReplySetupWizard';

const { Title, Text } = Typography;

const BRAND = '#25d366';
const BRAND_SOFT = '#f0faf4';
const CARD_STYLE = {
  boxShadow: '0 2px 10px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)',
  borderRadius: 10,
  border: '1px solid #eaeaea',
};

export function ReplyPage() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeKbId, setActiveKbId] = useState<number | null>(null);
  const [settings, setSettings] = useState<TenantReplySettings | null>(null);
  const [tab, setTab] = useState('overview');
  const [wizardOpen, setWizardOpen] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const [listRes, settingsRes] = await Promise.all([
        kbApi.list(),
        replySettingsApi.get(),
      ]);
      setKbs(listRes);
      setSettings(settingsRes);
      // 选默认 KB · 没有就选第一个
      const defaultKb = listRes.find((k) => k.isDefault) ?? listRes[0] ?? null;
      if (defaultKb && activeKbId === null) setActiveKbId(defaultKb.id);
    } catch (err) {
      message.error(extractErrorMessage(err, '加载失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeKb = useMemo(
    () => kbs.find((k) => k.id === activeKbId) ?? null,
    [kbs, activeKbId],
  );

  const noKbYet = kbs.length === 0;

  const handleOpenWizard = () => {
    setWizardOpen(true);
  };

  const handleModeChange = async (mode: TenantReplySettings['mode']) => {
    if (!settings) return;
    if (mode === settings.mode) return; // 没变不处理

    // 2026-04-24 · 所有切换都要确认 · 租户踏实
    const confirmCopy: Record<
      TenantReplySettings['mode'],
      { title: string; content: string; okText: string; danger?: boolean }
    > = {
      off: {
        title: '确定关闭自动回复?',
        content:
          '关闭后 · 客户回复广告时系统 100% 不会自动处理 · 全部留给人工. 广告跑了也没人自动回 · 确认?',
        okText: '确定关闭',
        danger: true,
      },
      faq: {
        title: '确定启用 FAQ 模式?',
        content:
          '只用 FAQ 匹配客户消息 · 命中就回 · 没命中的自动转"人工接管". 无需配置 AI Key · 免费使用.',
        okText: '确定启用',
      },
      smart: {
        title: '确定启用 AI 智能模式?',
        content:
          'FAQ 命中优先回 · 不命中调 AI 兜底答. AI 答不确定的转人工. 需要你自己的 AI API Key (费用租户承担).',
        okText: '确定启用',
      },
    };
    const cfg = confirmCopy[mode];

    modal.confirm({
      title: cfg.title,
      content: <div style={{ fontSize: 13, lineHeight: 1.8 }}>{cfg.content}</div>,
      okText: cfg.okText,
      cancelText: '不变',
      okButtonProps: cfg.danger
        ? undefined
        : { style: { background: BRAND, borderColor: BRAND } },
      okType: cfg.danger ? 'danger' : 'primary',
      onOk: async () => {
        // 2026-04-24 · 只有 smart 需要查 AI · faq 不需要
        if (mode === 'smart') {
          try {
            const res = await api.get<Array<{ enabled: boolean }>>('/ai-providers');
            const hasEnabled = res.data.some((p) => p.enabled);
            if (!hasEnabled) {
              modal.confirm({
                title: '需要先配置 AI',
                content: (
                  <div>
                    <p style={{ marginBottom: 8 }}>
                      AI 智能模式需要调用 AI 生成回复 · 你还没配置自己的 AI key.
                    </p>
                    <p style={{ marginBottom: 8, color: '#666', fontSize: 13 }}>
                      去 <b>设置 → AI 配置</b> 填一个 API Key (支持 DeepSeek / OpenAI /
                      Gemini / Claude) · 回来再启用.
                    </p>
                    <p style={{ marginBottom: 0, color: '#25d366', fontSize: 12 }}>
                      💡 如果你只想用 FAQ · 不需要 AI Key · 直接选 "FAQ 模式" 就行
                    </p>
                  </div>
                ),
                okText: '去配置 AI',
                cancelText: '暂不启用',
                okButtonProps: { style: { background: BRAND, borderColor: BRAND } },
                onOk: () => {
                  navigate('/admin?tab=ai');
                },
              });
              return;
            }
          } catch (err) {
            message.warning(extractErrorMessage(err, '无法检查 AI 配置 · 继续启用'));
          }
        }

        try {
          const updated = await replySettingsApi.update({ mode });
          setSettings(updated);
          message.success(
            mode === 'off'
              ? '已关闭自动回复'
              : mode === 'faq'
                ? 'FAQ 模式已启用'
                : 'AI 智能模式已启用',
          );
        } catch (err) {
          message.error(extractErrorMessage(err, '保存失败'));
        }
      },
    });
  };

  const handleSetDefaultKb = async (kbId: number) => {
    if (!settings) return;
    try {
      const updated = await replySettingsApi.update({ defaultKbId: kbId });
      setSettings(updated);
      message.success('已设为默认知识库');
    } catch (err) {
      message.error(extractErrorMessage(err, '保存失败'));
    }
  };

  // ── 渲染 ─────────────────────────────────

  return (
    <div>
      {/* 页眉 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 16,
        }}
      >
        <div>
          <Title level={3} style={{ margin: 0 }}>
            <RobotOutlined style={{ color: BRAND, marginRight: 8 }} />
            智能客服
          </Title>
          <Text type="secondary">
            上传产品介绍 · 选择模式 · 系统自动帮你回复客户咨询
          </Text>
        </div>
        {!noKbYet && (
          <Button onClick={handleOpenWizard} icon={<BookOutlined />}>
            引导设置
          </Button>
        )}
      </div>

      {/* 无 KB · 引导创建 */}
      {noKbYet && !loading && (
        <Card style={{ ...CARD_STYLE, marginBottom: 16 }}>
          <div
            style={{
              padding: '48px 20px',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                background: BRAND_SOFT,
                color: BRAND,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 34,
                marginBottom: 16,
              }}
            >
              <BookOutlined />
            </div>
            <Title level={4} style={{ margin: 0, marginBottom: 6 }}>
              一键开始 · 3 步搞定
            </Title>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              ① 上传公司/产品介绍 (PDF/Word/txt)
            </Text>
            <Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
              ② AI 自动生成 30 条 FAQ (待你审核)
            </Text>
            <Text type="secondary" style={{ display: 'block', marginBottom: 20 }}>
              ③ 选择模式 → 客户回复自动处理
            </Text>
            <Button
              type="primary"
              size="large"
              icon={<BookOutlined />}
              onClick={handleOpenWizard}
              style={{ background: BRAND, borderColor: BRAND }}
            >
              引导设置 · 开始
            </Button>
          </div>
        </Card>
      )}

      {/* 有 KB · 主视图 */}
      {!noKbYet && settings && (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {/* 模式切换卡 */}
          <ReplyModeCard
            mode={settings.mode}
            onChange={handleModeChange}
            defaultKb={kbs.find((k) => k.id === settings.defaultKbId) ?? null}
          />

          {/* 4 tab · 概览 / 知识库 / 高级设置 / (预留审计) */}
          <Card
            style={CARD_STYLE}
            styles={{ body: { padding: 0 } }}
          >
            <Tabs
              activeKey={tab}
              onChange={setTab}
              style={{ padding: '0 16px' }}
              items={[
                {
                  key: 'overview',
                  label: (
                    <span>
                      <MessageOutlined /> 概览
                    </span>
                  ),
                  children: (
                    <div style={{ padding: 16 }}>
                      <ReplyOverviewPanel
                        kbs={kbs}
                        activeKb={activeKb}
                        settings={settings}
                      />
                    </div>
                  ),
                },
                {
                  key: 'kb',
                  label: (
                    <span>
                      <BookOutlined /> 知识库
                    </span>
                  ),
                  children: (
                    <div style={{ padding: 16 }}>
                      <KnowledgeBasePanel
                        kbs={kbs}
                        activeKbId={activeKbId}
                        onSelectKb={setActiveKbId}
                        onChange={reload}
                        defaultKbId={settings.defaultKbId}
                        onSetDefault={handleSetDefaultKb}
                      />
                    </div>
                  ),
                },
                {
                  key: 'settings',
                  label: (
                    <span>
                      <SettingOutlined /> 高级设置
                    </span>
                  ),
                  children: (
                    <div style={{ padding: 16 }}>
                      <ReplyAdvancedSettings
                        settings={settings}
                        onChange={(v) => setSettings(v)}
                      />
                    </div>
                  ),
                },
              ]}
            />
          </Card>

          <Alert
            type="info"
            showIcon
            message="自动回复启用后, 客户回广告消息时系统会自动判断: 能回 FAQ 就回 · 不确定的转人工 · 24 小时最多回 3 次, 30 分钟内不重复回 · 进入人工接管后 AI 自动停止"
          />
        </Space>
      )}

      {loading && !settings && (
        <Card style={CARD_STYLE} loading />
      )}

      {/* 引导向导 */}
      <ReplySetupWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onDone={() => {
          setWizardOpen(false);
          void reload();
        }}
      />
    </div>
  );
}
