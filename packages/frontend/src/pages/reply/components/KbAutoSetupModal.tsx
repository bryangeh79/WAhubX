// 2026-04-24 · 上传后"一键搞定" Modal
// 租户拖文件 → 上传成功 → 自动弹这个 Modal
// 可选三件事 (默认 2/3 勾上): 生成 FAQ / 审核启用 / 启用智能模式
import { useEffect, useState } from 'react';
import {
  App,
  Checkbox,
  Modal,
  Progress,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  CheckCircleFilled,
  LoadingOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import {
  kbApi,
  replySettingsApi,
  type KbSource,
  type KbStats,
  type ReplyMode,
} from '@/lib/intelligent-reply-api';
import { extractErrorMessage } from '@/lib/api';

const BRAND = '#25d366';
const BRAND_SOFT = '#f0faf4';

interface Props {
  open: boolean;
  kbId: number;
  source: KbSource | null;
  currentMode: ReplyMode;
  stats?: KbStats;
  onClose: () => void;
  onDone: (result: { faqGenerated: number; autoEnabled: boolean; modeEnabled: boolean }) => void;
}

type Step = 'confirm' | 'running' | 'done';

export function KbAutoSetupModal({
  open,
  kbId,
  source,
  currentMode,
  stats,
  onClose,
  onDone,
}: Props) {
  const { message } = App.useApp();
  const [step, setStep] = useState<Step>('confirm');
  const [optGenerate, setOptGenerate] = useState(true);
  const [optApprove, setOptApprove] = useState(true);
  const [optEnableMode, setOptEnableMode] = useState(currentMode === 'off');

  const [faqProgressText, setFaqProgressText] = useState('');
  const [faqPct, setFaqPct] = useState(0);
  const [approveDone, setApproveDone] = useState<null | boolean>(null);
  const [modeDone, setModeDone] = useState<null | boolean>(null);
  const [finalFaqCount, setFinalFaqCount] = useState(0);

  useEffect(() => {
    if (open) {
      setStep('confirm');
      setOptGenerate(true);
      setOptApprove(true);
      setOptEnableMode(currentMode === 'off');
      setFaqProgressText('');
      setFaqPct(0);
      setApproveDone(null);
      setModeDone(null);
      setFinalFaqCount(0);
    }
  }, [open, currentMode]);

  const handleRun = async () => {
    setStep('running');
    let faqGenerated = 0;
    let autoEnabled = false;
    let modeEnabled = false;

    // 生成 FAQ
    if (optGenerate) {
      setFaqProgressText('正在让 DeepSeek 读文档 · 通常 15-30 秒...');
      setFaqPct(20);
      try {
        // 假装在推进 (真实只有一次 API 调用)
        const tick = setInterval(() => {
          setFaqPct((p) => (p < 85 ? p + 5 : p));
        }, 1500);
        const res = await kbApi.generateFaqs(kbId, 30);
        clearInterval(tick);
        setFaqPct(100);
        faqGenerated = res.generated;
        setFaqProgressText(`生成完成 · ${res.generated} 条新 FAQ${res.skippedDup > 0 ? ` · 跳过 ${res.skippedDup} 重复` : ''}`);
      } catch (err) {
        setFaqPct(0);
        setFaqProgressText(`生成失败: ${extractErrorMessage(err, 'unknown')}`);
        message.error('FAQ 生成失败 · 可稍后手动重试');
      }
    } else {
      setFaqPct(100);
      setFaqProgressText('跳过生成');
    }

    // 审核启用
    if (optApprove && optGenerate) {
      try {
        const res = await kbApi.approveAllDrafts(kbId);
        autoEnabled = true;
        setApproveDone(true);
        // 刷新最终 FAQ 数 (审核后的 enabled)
        const s = await kbApi.stats(kbId);
        setFinalFaqCount(s.faqEnabled);
        void res;
      } catch (err) {
        setApproveDone(false);
        message.error(extractErrorMessage(err, '审核启用失败'));
      }
    } else if (optApprove && !optGenerate) {
      setApproveDone(false);
    }

    // 启用智能模式
    if (optEnableMode) {
      try {
        await replySettingsApi.update({ mode: 'smart', defaultKbId: kbId });
        modeEnabled = true;
        setModeDone(true);
      } catch (err) {
        setModeDone(false);
        message.error(extractErrorMessage(err, '启用模式失败'));
      }
    }

    setStep('done');
    // 通知父组件
    setTimeout(() => {
      onDone({ faqGenerated, autoEnabled, modeEnabled });
    }, 100);
  };

  // ── 渲染 ─────────────────────────────────

  const autoEntities = stats?.entities ?? 0;
  const chunkCount = stats?.chunks ?? 0;

  return (
    <Modal
      open={open}
      footer={null}
      closable={step !== 'running'}
      onCancel={step === 'running' ? undefined : onClose}
      width={540}
      destroyOnHidden
      title={
        step === 'done' ? (
          <Space>
            <CheckCircleFilled style={{ color: BRAND, fontSize: 20 }} />
            <span>准备就绪 · 可以收客户消息了</span>
          </Space>
        ) : (
          <Space>
            <RocketOutlined style={{ color: BRAND, fontSize: 20 }} />
            <span>文档已上传 · 一键搞定?</span>
          </Space>
        )
      }
    >
      {step === 'confirm' && (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {/* 文件信息 */}
          <div
            style={{
              background: BRAND_SOFT,
              border: `1px solid ${BRAND}40`,
              borderRadius: 10,
              padding: 14,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              📄 {source?.fileName ?? '(未知)'}{' '}
              <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 'normal' }}>
                {source ? `${(source.byteSize / 1024).toFixed(1)} KB` : ''}
              </Typography.Text>
            </div>
            <div style={{ fontSize: 12, color: '#555', lineHeight: 1.8 }}>
              ✅ 已解析文本 · 切成 {chunkCount} 段<br />
              ✅ 已做向量检索 (语义搜索用)<br />
              ✅ 已提取 {autoEntities} 条联系方式 (AI 回复时会保留不改)
            </div>
          </div>

          {/* 可选项 */}
          <div>
            <Typography.Text strong style={{ fontSize: 13 }}>
              接着要系统自动做吗:
            </Typography.Text>
            <Space direction="vertical" size={10} style={{ width: '100%', marginTop: 8 }}>
              <OptionRow
                checked={optGenerate}
                onChange={setOptGenerate}
                title="AI 生成 30 条常见 FAQ"
                desc="DeepSeek 读你文档 · 自动出 30 条客户可能问的 Q/A · 15-30 秒"
                tag={<Tag color="success">推荐</Tag>}
              />
              <OptionRow
                checked={optApprove}
                onChange={setOptApprove}
                title="自动审核启用"
                desc="跳过逐条审核 · FAQ 直接启用 · 你后续随时可以在 FAQ tab 停用某几条"
                disabled={!optGenerate}
              />
              <OptionRow
                checked={optEnableMode}
                onChange={setOptEnableMode}
                title="立即启用智能模式"
                desc={
                  currentMode === 'off'
                    ? '当前"关闭"状态 · 勾选后系统开始自动处理客户回复'
                    : `当前已是"${currentMode === 'smart' ? '智能' : '草稿'}"模式 · 勾选切到智能`
                }
              />
            </Space>
          </div>

          {/* 按钮 */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 8,
              paddingTop: 4,
              borderTop: '1px solid #f0f0f0',
            }}
          >
            <a onClick={onClose} style={{ color: '#999' }} role="button">
              稍后自己来
            </a>
            <button
              onClick={handleRun}
              style={{
                background: BRAND,
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '10px 20px',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(37,211,102,0.3)',
              }}
            >
              一键完成 →
            </button>
          </div>
        </Space>
      )}

      {step === 'running' && (
        <Space direction="vertical" size={18} style={{ width: '100%', padding: '12px 0' }}>
          {optGenerate && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                {faqPct === 100 ? (
                  <CheckCircleFilled style={{ color: BRAND }} />
                ) : (
                  <LoadingOutlined style={{ color: BRAND }} />
                )}
                <Typography.Text strong style={{ fontSize: 13 }}>
                  生成 FAQ
                </Typography.Text>
              </div>
              <Progress
                percent={faqPct}
                strokeColor={{ from: BRAND, to: '#13c2c2' }}
                size="small"
                status={faqPct === 100 ? 'success' : 'active'}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {faqProgressText}
              </Typography.Text>
            </div>
          )}

          {optApprove && optGenerate && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {approveDone === true ? (
                <CheckCircleFilled style={{ color: BRAND }} />
              ) : approveDone === false ? (
                <span style={{ color: '#f5222d' }}>✗</span>
              ) : faqPct === 100 ? (
                <LoadingOutlined style={{ color: BRAND }} />
              ) : (
                <span style={{ color: '#ccc' }}>○</span>
              )}
              <span style={{ fontSize: 13 }}>审核启用所有 FAQ</span>
            </div>
          )}

          {optEnableMode && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {modeDone === true ? (
                <CheckCircleFilled style={{ color: BRAND }} />
              ) : modeDone === false ? (
                <span style={{ color: '#f5222d' }}>✗</span>
              ) : (faqPct === 100 && (!optApprove || approveDone !== null)) ? (
                <LoadingOutlined style={{ color: BRAND }} />
              ) : (
                <span style={{ color: '#ccc' }}>○</span>
              )}
              <span style={{ fontSize: 13 }}>启用智能模式</span>
            </div>
          )}
        </Space>
      )}

      {step === 'done' && (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div
            style={{
              background: BRAND_SOFT,
              border: `1px solid ${BRAND}`,
              borderRadius: 10,
              padding: 18,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
            <Typography.Title level={5} style={{ margin: 0, marginBottom: 6 }}>
              全部搞定
            </Typography.Title>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              知识库已装备好 · 系统随时待命
            </Typography.Text>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
            {optGenerate && faqPct === 100 && (
              <Row>
                <CheckCircleFilled style={{ color: BRAND }} />
                <span>
                  {finalFaqCount > 0 ? (
                    <>
                      <b style={{ color: BRAND }}>{finalFaqCount}</b> 条 FAQ 已启用
                    </>
                  ) : (
                    'FAQ 已生成'
                  )}
                </span>
              </Row>
            )}
            {optApprove && approveDone && (
              <Row>
                <CheckCircleFilled style={{ color: BRAND }} />
                <span>审核自动完成</span>
              </Row>
            )}
            {optEnableMode && modeDone && (
              <Row>
                <CheckCircleFilled style={{ color: BRAND }} />
                <span>智能模式已启用 · 客户回复会自动处理</span>
              </Row>
            )}
          </div>

          <div
            style={{
              background: '#f7f7f7',
              border: '1px solid #e8e8e8',
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 12,
              color: '#666',
              lineHeight: 1.7,
            }}
          >
            💡 <b>接下来会自动发生:</b><br />
            · 客户回你广告消息时, 系统先查 FAQ 匹配<br />
            · 不命中的用 AI 基于你文档回复<br />
            · 判断"想成交/投诉"等立即转"人工接管" tab
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={onClose}
              style={{
                background: BRAND,
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '8px 24px',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              完成
            </button>
          </div>
        </Space>
      )}
    </Modal>
  );
}

function OptionRow({
  checked,
  onChange,
  title,
  desc,
  tag,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  desc: string;
  tag?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div
      onClick={() => !disabled && onChange(!checked)}
      style={{
        display: 'flex',
        gap: 10,
        padding: '10px 12px',
        border: `1px solid ${checked ? BRAND : '#e8e8e8'}`,
        background: checked ? BRAND_SOFT : '#fff',
        borderRadius: 8,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.15s',
      }}
    >
      <Checkbox
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        onClick={(e) => e.stopPropagation()}
        style={{ marginTop: 2 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Typography.Text strong style={{ fontSize: 13 }}>
            {title}
          </Typography.Text>
          {tag}
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {desc}
        </Typography.Text>
      </div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{children}</div>;
}
