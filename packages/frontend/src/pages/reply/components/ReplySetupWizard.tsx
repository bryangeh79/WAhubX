// 2026-04-24 · 智能客服引导向导
// 流程:
//   1. 欢迎 + 选单/多产品
//   2. 建 "公司通用" KB + 上传公司文档 + 自动生成 FAQ
//   3. (多产品) 依次建每个产品 KB + 上传文档 + 生成 FAQ
//   4. 启用智能模式 + 完成
//
// 设计原则: 每一步都是一口气 · 每步完成后自动 "下一步"
import { useEffect, useRef, useState } from 'react';
import {
  App,
  Button,
  Input,
  Modal,
  Progress,
  Select,
  Space,
  Tag,
  Typography,
  Upload,
} from 'antd';
import type { UploadProps } from 'antd';
import {
  BankOutlined,
  CheckCircleFilled,
  InboxOutlined,
  LoadingOutlined,
  PlusOutlined,
  RocketOutlined,
  ShopOutlined,
} from '@ant-design/icons';
import {
  kbApi,
  replySettingsApi,
  type KnowledgeBase,
} from '@/lib/intelligent-reply-api';
import { api, extractErrorMessage } from '@/lib/api';

const BRAND = '#25d366';
const BRAND_SOFT = '#f0faf4';

// 2026-04-24 · 10 个通用目标 + 1 通用兜底 · 按"要达成什么"分类 · 与行业无关
// 租户可下拉选 · 或自己写 · {NAME} 自动替换成知识库名称
const GOAL_TEMPLATES: Array<{ icon: string; label: string; template: string }> = [
  {
    icon: '✨',
    label: '综合 · 不确定时用 (推荐)',
    template: '让客户了解 {NAME} · 根据客户意向自动决定引导方向 · 最终留下联系方式',
  },
  {
    icon: '💬',
    label: '收集联系方式 (WhatsApp / 邮箱 / 电话)',
    template: '让客户了解 {NAME} · 引导客户留下 WhatsApp / 邮箱 / 电话 · 便于后续跟进',
  },
  {
    icon: '📅',
    label: '引导预约 (到店 / 看房 / 试听 / 体验)',
    template: '让客户了解 {NAME} · 引导预约到店 / 看房 / 试听 / 体验',
  },
  {
    icon: '🛒',
    label: '促成下单 / 购买',
    template: '让客户了解 {NAME} 的卖点 · 解答成交疑虑 · 引导直接下单',
  },
  {
    icon: '👋',
    label: '引导加社群 / 关注 (微信群 / TG / FB)',
    template: '让客户了解 {NAME} · 引导加入社群或关注官方账号 · 获取最新资讯',
  },
  {
    icon: '💼',
    label: '询价 / 申请报价',
    template: '让客户了解 {NAME} · 收集客户需求细节 · 引导提交询价或申请报价',
  },
  {
    icon: '📎',
    label: '发送资料 (产品手册 / 案例 / 价格表)',
    template: '让客户了解 {NAME} · 主动发送详细资料 / 案例 / 价格表 · 让客户自助了解',
  },
  {
    icon: '🎯',
    label: '筛选高意向客户 · 转人工',
    template: '让客户了解 {NAME} · 判断客户意向度 · 高意向客户尽快转人工跟进',
  },
  {
    icon: '📝',
    label: '引导填表单 / 注册 / 试用',
    template: '让客户了解 {NAME} · 引导填写表单 / 免费注册 / 申请试用',
  },
  {
    icon: '❓',
    label: '售前答疑 · 解答常见问题',
    template: '让客户了解 {NAME} · 优先解答客户疑问 · 为后续成交铺垫信任',
  },
  {
    icon: '🏷',
    label: '推广优惠活动 (促销 / 限时)',
    template: '让客户了解 {NAME} · 重点推广当前优惠活动 · 制造紧迫感促成转化',
  },
];

function buildGoalFromTemplate(template: string, name: string): string {
  return template.replace(/\{NAME\}/g, name.trim() || '我们的产品');
}

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

type WizardStep =
  | 'welcome'
  | 'company'        // 公司通用 KB
  | 'product'        // 产品 KB (可多个)
  | 'addMore'        // 问 "还有吗"
  | 'enableMode'     // 启用模式
  | 'done';

interface KbBuild {
  name: string;
  kind: 'company' | 'product';
  files: File[];
  goal: string;
  kbId?: number;
  faqCount?: number;
  error?: string;
  status: 'pending' | 'creating' | 'uploading' | 'generating' | 'done' | 'error';
}

export function ReplySetupWizard({ open, onClose, onDone }: Props) {
  const { message } = App.useApp();
  const [step, setStep] = useState<WizardStep>('welcome');
  const [multiProduct, setMultiProduct] = useState<boolean | null>(null);
  const [productIndex, setProductIndex] = useState(1);

  // 当前正在编辑的 KB
  const [currentName, setCurrentName] = useState('');
  const [currentFiles, setCurrentFiles] = useState<File[]>([]);
  const [currentGoal, setCurrentGoal] = useState('');

  // 进度
  const [runningBuild, setRunningBuild] = useState<KbBuild | null>(null);
  const [completed, setCompleted] = useState<KbBuild[]>([]);
  const [enablingMode, setEnablingMode] = useState(false);

  // 2026-04-25 · 检测已存在的公司通用 KB · 有则跳过"建公司 KB"步骤
  const [existingCompanyKb, setExistingCompanyKb] = useState<KnowledgeBase | null>(null);

  const currentKind = useRef<'company' | 'product'>('company');

  const reset = () => {
    setStep('welcome');
    setMultiProduct(null);
    setProductIndex(1);
    setCurrentName('');
    setCurrentFiles([]);
    setCurrentGoal('');
    setRunningBuild(null);
    setCompleted([]);
    setEnablingMode(false);
    setExistingCompanyKb(null);
  };

  // 打开时检测 · 有 default KB 就预置到 completed · 跳过公司步骤
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const all = await kbApi.list();
        const company = all.find((k) => k.isDefault) ?? null;
        if (cancelled) return;
        setExistingCompanyKb(company);
        if (company) {
          setCompleted([
            {
              name: company.name,
              kind: 'company',
              files: [],
              goal: company.goalPrompt ?? '',
              kbId: company.id,
              status: 'done',
            },
          ]);
          // 有已存在公司 KB 时默认按多产品流程处理 · 允许"加更多"
          setMultiProduct(true);
        }
      } catch {
        // 忽略 · 按空场景走原流程
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleClose = () => {
    if (runningBuild && runningBuild.status !== 'done' && runningBuild.status !== 'error') {
      message.warning('当前步骤还在进行中...');
      return;
    }
    reset();
    onClose();
  };

  // ── 构建一个 KB 的完整流程 ────────────────

  const buildKb = async (config: Omit<KbBuild, 'status'>): Promise<KbBuild> => {
    const build: KbBuild = { ...config, status: 'creating' };
    setRunningBuild(build);

    try {
      // 1. 建 KB
      const kb: KnowledgeBase = await kbApi.create({
        name: config.name,
        goalPrompt: config.goal,
        isDefault: config.kind === 'company',
      });
      build.kbId = kb.id;

      // 2. 逐个上传文件
      if (config.files.length > 0) {
        build.status = 'uploading';
        setRunningBuild({ ...build });
        for (const file of config.files) {
          await kbApi.uploadFile(kb.id, file);
        }
      }

      // 3. 等 2 秒让 embedding 完成
      await new Promise((r) => setTimeout(r, 2000));

      // 4. 生成 FAQ (若上传了文件)
      if (config.files.length > 0) {
        build.status = 'generating';
        setRunningBuild({ ...build });
        try {
          const res = await kbApi.generateFaqs(kb.id, 30);
          build.faqCount = res.generated;
          // 审核启用
          await kbApi.approveAllDrafts(kb.id);
        } catch (err) {
          build.error = `FAQ 生成失败: ${extractErrorMessage(err, 'unknown')}`;
        }
      }

      build.status = 'done';
      setRunningBuild({ ...build });
      return build;
    } catch (err) {
      build.status = 'error';
      build.error = extractErrorMessage(err, '失败');
      setRunningBuild({ ...build });
      throw err;
    }
  };

  // ── 步骤操作 ────────────────────────────

  const startCompany = () => {
    currentKind.current = 'company';
    setCurrentName('公司通用');
    setCurrentGoal('让客户了解本公司的服务和联系方式 · 引导咨询或预约');
    setCurrentFiles([]);
    setStep('company');
  };

  const startFirstProduct = () => {
    currentKind.current = 'product';
    setCurrentName('');
    setCurrentGoal('');
    setCurrentFiles([]);
    setProductIndex(1);
    setStep('product');
  };

  // 2026-04-24 · 重构: 接受直接传入 config · 不从 state 读 (避免 stale closure)
  const buildCurrent = async (directConfig?: Omit<KbBuild, 'status'>) => {
    const config: Omit<KbBuild, 'status'> = directConfig ?? {
      name: currentName.trim(),
      kind: currentKind.current,
      files: currentFiles,
      goal: currentGoal.trim() || (undefined as unknown as string),
    };
    const build = await buildKb(config).catch((err) => {
      message.error(`建 KB 失败: ${extractErrorMessage(err, 'unknown')}`);
      return null;
    });
    if (!build) return;
    if (build.status === 'error') {
      message.error(build.error ?? '建 KB 失败 · 请查看 F12 控制台');
      return;
    }

    setCompleted((prev) => [...prev, build]);

    // 走向下一步
    if (config.kind === 'company') {
      if (multiProduct) {
        startFirstProduct();
      } else {
        // 单产品场景: 公司 KB 建完 + 再让他建一个主产品 KB
        setStep('addMore'); // 会显示 "要建产品 KB 吗"
      }
    } else {
      // 产品 KB 建完
      setStep('addMore');
    }
  };

  const addAnotherProduct = () => {
    currentKind.current = 'product';
    setCurrentName('');
    setCurrentGoal('');
    setCurrentFiles([]);
    setProductIndex((i) => i + 1);
    setStep('product');
  };

  const skipToEnd = () => {
    setStep('enableMode');
  };

  // 2026-04-24 · 接受参数 · 'faq' 或 'smart'
  const enableAndFinish = async (chosenMode: 'faq' | 'smart') => {
    setEnablingMode(true);
    try {
      const defaultKb = completed.find((c) => c.kind === 'company')?.kbId ?? null;

      // smart 需要检查 AI · faq 不需要
      if (chosenMode === 'smart') {
        const providersRes = await api
          .get<Array<{ enabled: boolean }>>('/ai-providers')
          .catch(() => null);
        const hasAi = providersRes?.data.some((p) => p.enabled) ?? false;
        if (!hasAi) {
          message.warning({
            content:
              '你还没配置 AI Key · 暂改用 FAQ 模式 · 以后去"设置 → AI 配置"填 Key 后, 可升级智能模式',
            duration: 6,
          });
          // 降级到 faq (用户上传了文档 · FAQ 已备好 · 直接启用 faq 最合理)
          if (defaultKb) {
            await replySettingsApi.update({ mode: 'faq', defaultKbId: defaultKb });
          }
          setStep('done');
          return;
        }
      }

      if (defaultKb) {
        await replySettingsApi.update({
          mode: chosenMode,
          defaultKbId: defaultKb,
        });
      }
      setStep('done');
    } catch (err) {
      message.error(extractErrorMessage(err, '启用失败'));
    } finally {
      setEnablingMode(false);
    }
  };

  const finishWithoutEnable = async () => {
    // 至少把 default KB 设一下
    const defaultKb = completed.find((c) => c.kind === 'company')?.kbId ?? null;
    if (defaultKb) {
      try {
        await replySettingsApi.update({ defaultKbId: defaultKb });
      } catch {
        // 忽略
      }
    }
    setStep('done');
  };

  // ── 上传控件 ─────────────────────────────

  const uploadProps: UploadProps = {
    accept: '.pdf,.docx,.txt,.md',
    multiple: true,
    showUploadList: false,
    beforeUpload: (file) => {
      if (file.size > 20 * 1024 * 1024) {
        message.warning('文件不能超过 20 MB');
        return Upload.LIST_IGNORE;
      }
      setCurrentFiles((prev) => {
        if (prev.some((f) => f.name === file.name)) return prev;
        return [...prev, file as unknown as File];
      });
      return Upload.LIST_IGNORE;
    },
  };

  // ── 渲染 ─────────────────────────────────

  const productCount = completed.filter((c) => c.kind === 'product').length;

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      footer={null}
      closable={step === 'done' || !runningBuild || runningBuild.status === 'done' || runningBuild.status === 'error'}
      width={600}
      destroyOnHidden
      title={
        <Space>
          <RocketOutlined style={{ color: BRAND }} />
          <span>智能客服 · 引导设置</span>
          <Tag color="default" style={{ fontSize: 11 }}>
            第 {getStepNumber(step, multiProduct, productIndex, productCount, !!existingCompanyKb)} / {totalSteps(multiProduct ?? false, !!existingCompanyKb)}
          </Tag>
        </Space>
      }
    >
      {/* ═══ 欢迎页 ═══ */}
      {step === 'welcome' && (
        <Space direction="vertical" size={18} style={{ width: '100%' }}>
          <div style={{ textAlign: 'center', padding: '14px 0 6px' }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>🤖</div>
            <Typography.Title level={4} style={{ margin: 0, marginBottom: 4 }}>
              欢迎使用智能客服
            </Typography.Title>
            <Typography.Text type="secondary">
              跟着向导 · 2 分钟装配好你的 AI 客服
            </Typography.Text>
          </div>

          {existingCompanyKb ? (
            <div style={{ background: BRAND_SOFT, borderRadius: 10, padding: 14 }}>
              <Typography.Text strong style={{ fontSize: 13 }}>
                <CheckCircleFilled style={{ color: BRAND, marginRight: 6 }} />
                已检测到「{existingCompanyKb.name}」知识库
              </Typography.Text>
              <div style={{ fontSize: 13, lineHeight: 2, color: '#555', marginTop: 4 }}>
                这次只用再添加产品知识库就行:<br />
                ① 建"产品"知识库 · 放产品介绍书<br />
                ② 自动生成 30 条 FAQ · 自动启用<br />
                ③ 开启智能模式 · 客户回复自动处理
              </div>
            </div>
          ) : (
            <div style={{ background: BRAND_SOFT, borderRadius: 10, padding: 14 }}>
              <Typography.Text strong style={{ fontSize: 13 }}>
                向导会帮你:
              </Typography.Text>
              <div style={{ fontSize: 13, lineHeight: 2, color: '#555', marginTop: 4 }}>
                ① 建"公司通用"知识库 · 放公司介绍/联系方式<br />
                ② 建"产品"知识库 · 每个产品一个 · 分别放介绍书<br />
                ③ 每个 KB 自动生成 30 条 FAQ · 自动启用<br />
                ④ 开启智能模式 · 客户回复自动处理
              </div>
            </div>
          )}

          {!existingCompanyKb && (
            <div>
              <Typography.Text strong style={{ fontSize: 13 }}>
                你卖几种产品?
              </Typography.Text>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
                <ChoiceCard
                  selected={multiProduct === false}
                  onClick={() => setMultiProduct(false)}
                  icon={<ShopOutlined />}
                  title="只有 1 个"
                  desc="单一产品/服务 · 建 1 个 KB 搞定"
                />
                <ChoiceCard
                  selected={multiProduct === true}
                  onClick={() => setMultiProduct(true)}
                  icon={<PlusOutlined />}
                  title="多个产品"
                  desc="2 个或以上 · 每个产品单独 KB · 回复精准不混"
                />
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4 }}>
            <a onClick={handleClose} style={{ color: '#999' }}>
              稍后再说
            </a>
            <PrimaryBtn
              disabled={!existingCompanyKb && multiProduct === null}
              onClick={existingCompanyKb ? startFirstProduct : startCompany}
            >
              {existingCompanyKb ? '开始 · 建产品 KB →' : '开始 · 建第 1 个 KB →'}
            </PrimaryBtn>
          </div>
        </Space>
      )}

      {/* ═══ 步骤: 建公司通用 KB ═══ */}
      {step === 'company' && (
        <CompanyInfoForm
          files={currentFiles}
          onFilesChange={setCurrentFiles}
          uploadProps={uploadProps}
          onBack={() => setStep('welcome')}
          onBuild={(text) => {
            // 把基本信息打包成虚拟 txt · 加上额外上传的文档 · 直接触发 buildCurrent (不走 state)
            const blob = new File([text], '公司基本资料.txt', {
              type: 'text/plain;charset=utf-8',
            });
            const allFiles = [
              blob,
              ...currentFiles.filter((f) => f.name !== '公司基本资料.txt'),
            ];
            currentKind.current = 'company';
            void buildCurrent({
              name: '公司通用',
              kind: 'company',
              files: allFiles,
              goal: '让客户了解本公司的服务和联系方式 · 引导咨询或预约',
            });
          }}
          runningBuild={runningBuild}
          completed={completed}
        />
      )}

      {/* ═══ 步骤: 建产品 KB ═══ */}
      {step === 'product' && (
        <KbBuildForm
          stepTitle={`建「产品 ${productIndex}」知识库`}
          stepDesc="这一步重点: 上传这个产品的介绍书 (PDF/Word) · AI 会读后自动出 FAQ"
          icon={<ShopOutlined style={{ color: BRAND, fontSize: 36 }} />}
          kbName={currentName}
          onKbNameChange={setCurrentName}
          goal={currentGoal}
          onGoalChange={setCurrentGoal}
          files={currentFiles}
          onFilesChange={setCurrentFiles}
          uploadProps={uploadProps}
          namePlaceholder="例: WAhubX 产品 / 保健品 Brand X"
          goalPlaceholder="例: 让客户了解此产品功能 · 引导预约 demo"
          onNext={() => {
            currentKind.current = 'product';
            void buildCurrent({
              name: currentName.trim(),
              kind: 'product',
              files: currentFiles,
              goal:
                currentGoal.trim() ||
                (undefined as unknown as string),
            });
          }}
          onBack={() => setStep('addMore')}
          runningBuild={runningBuild}
          completed={completed}
        />
      )}

      {/* ═══ 步骤: 要不要再加一个? ═══ */}
      {step === 'addMore' && (
        <Space direction="vertical" size={18} style={{ width: '100%' }}>
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>✓</div>
            <Typography.Title level={4} style={{ margin: 0, marginBottom: 4 }}>
              已建 {completed.length} 个知识库
            </Typography.Title>
            <Typography.Text type="secondary">
              要再加一个产品 KB, 还是现在完成?
            </Typography.Text>
          </div>

          <CompletedList completed={completed} />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <ChoiceCard
              selected={false}
              onClick={addAnotherProduct}
              icon={<PlusOutlined />}
              title="再加一个产品"
              desc="继续建下一个产品 KB"
            />
            <ChoiceCard
              selected={false}
              onClick={skipToEnd}
              icon={<CheckCircleFilled />}
              title="就这些 · 完成"
              desc="跳到最后一步启用智能模式"
            />
          </div>
        </Space>
      )}

      {/* ═══ 步骤: 启用智能模式 ═══ */}
      {step === 'enableMode' && (
        <Space direction="vertical" size={18} style={{ width: '100%' }}>
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>🎯</div>
            <Typography.Title level={4} style={{ margin: 0, marginBottom: 4 }}>
              最后一步 · 开启自动回复
            </Typography.Title>
            <Typography.Text type="secondary">
              所有 KB 已装配 · 现在开始自动处理客户消息吗?
            </Typography.Text>
          </div>

          <CompletedList completed={completed} />

          <Typography.Text strong style={{ fontSize: 13 }}>
            选一个启动模式:
          </Typography.Text>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {/* FAQ 模式 */}
            <div
              role="button"
              onClick={() => enableAndFinish('faq')}
              style={{
                border: '1px solid #8ee2ad',
                background: BRAND_SOFT,
                borderRadius: 10,
                padding: 14,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: 24, color: BRAND, marginBottom: 4 }}>❓</div>
              <div style={{ fontWeight: 600, fontSize: 14, color: BRAND, marginBottom: 4 }}>
                FAQ 模式
              </div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6, lineHeight: 1.5 }}>
                只用 FAQ 回客户 · 没命中转人工
              </div>
              <Tag color="success" style={{ margin: 0, fontSize: 11 }}>
                免费 · 无需 AI Key
              </Tag>
            </div>

            {/* AI 智能 */}
            <div
              role="button"
              onClick={() => enableAndFinish('smart')}
              style={{
                border: '1px solid #91caff',
                background: '#e6f4ff',
                borderRadius: 10,
                padding: 14,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: 24, color: '#1677ff', marginBottom: 4 }}>🤖</div>
              <div style={{ fontWeight: 600, fontSize: 14, color: '#1677ff', marginBottom: 4 }}>
                AI 智能 + FAQ
              </div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 6, lineHeight: 1.5 }}>
                FAQ 优先 · 不命中 AI 兜底
              </div>
              <Tag color="blue" style={{ margin: 0, fontSize: 11 }}>
                需配 AI Key · 按用量
              </Tag>
            </div>
          </div>

          <div
            style={{
              background: '#fffbe6',
              border: '1px solid #ffe58f',
              borderRadius: 8,
              padding: '10px 12px',
              fontSize: 12,
              color: '#666',
              lineHeight: 1.7,
            }}
          >
            💡 <b>建议</b>: 先用 FAQ 模式跑起来 · 等确认流程顺畅, 再去"设置 → AI 配置" 填 Key · 一键升级到智能模式
          </div>

          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <a onClick={finishWithoutEnable} style={{ color: '#999', fontSize: 13 }}>
              先不启用 · 我再想想
            </a>
          </div>
          {enablingMode && (
            <div style={{ textAlign: 'center', color: BRAND, fontSize: 12 }}>
              正在启用...
            </div>
          )}
        </Space>
      )}

      {/* ═══ 完成页 ═══ */}
      {step === 'done' && (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <div
            style={{
              background: BRAND_SOFT,
              border: `2px solid ${BRAND}`,
              borderRadius: 12,
              padding: 24,
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 56, marginBottom: 10 }}>🎉</div>
            <Typography.Title level={3} style={{ margin: 0, marginBottom: 6, color: BRAND }}>
              全部搞定!
            </Typography.Title>
            <Typography.Text type="secondary">
              {completed.length} 个知识库就位 · 客户回复会自动处理
            </Typography.Text>
          </div>

          <CompletedList completed={completed} />

          <div
            style={{
              background: '#fffbe6',
              border: '1px solid #ffe58f',
              borderRadius: 8,
              padding: 12,
              fontSize: 12,
              color: '#666',
              lineHeight: 1.7,
            }}
          >
            💡 <b>提示</b>: 接下来去"广告投放"创建投放时, 可以**为每个投放选对应的产品知识库** · 客户回复会用正确的产品知识答
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <PrimaryBtn
              onClick={() => {
                onDone();
                reset();
              }}
            >
              完成
            </PrimaryBtn>
          </div>
        </Space>
      )}
    </Modal>
  );
}

// ─────────────────────────────────────────
// 子组件
// ─────────────────────────────────────────

function ChoiceCard({
  selected,
  onClick,
  icon,
  title,
  desc,
}: {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        border: selected ? `2px solid ${BRAND}` : '1px solid #e0e0e0',
        background: selected ? BRAND_SOFT : '#fff',
        borderRadius: 10,
        padding: selected ? '15px 14px' : '16px 14px',
        cursor: 'pointer',
        transition: 'all 0.15s',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 24, color: selected ? BRAND : '#8c8c8c', marginBottom: 6 }}>
        {icon}
      </div>
      <div style={{ fontWeight: 600, fontSize: 13, color: selected ? BRAND : '#333' }}>
        {title}
      </div>
      <div style={{ fontSize: 11, color: '#8c8c8c', marginTop: 2 }}>{desc}</div>
    </div>
  );
}

function KbBuildForm({
  stepTitle,
  stepDesc,
  icon,
  kbName,
  onKbNameChange,
  goal,
  onGoalChange,
  files,
  onFilesChange,
  uploadProps,
  namePlaceholder,
  goalPlaceholder,
  onNext,
  onBack,
  runningBuild,
  completed,
}: {
  stepTitle: string;
  stepDesc: string;
  icon: React.ReactNode;
  kbName: string;
  onKbNameChange: (v: string) => void;
  goal: string;
  onGoalChange: (v: string) => void;
  files: File[];
  onFilesChange: (f: File[]) => void;
  uploadProps: UploadProps;
  namePlaceholder?: string;
  goalPlaceholder: string;
  onNext: () => void;
  onBack: () => void;
  runningBuild: KbBuild | null;
  completed: KbBuild[];
}) {
  const building = runningBuild?.status && runningBuild.status !== 'done' && runningBuild.status !== 'error';

  if (building) {
    return <BuildProgress build={runningBuild!} />;
  }

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <div style={{ textAlign: 'center', padding: '6px 0' }}>
        {icon}
        <Typography.Title level={5} style={{ margin: '8px 0 4px' }}>
          {stepTitle}
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {stepDesc}
        </Typography.Text>
      </div>

      {completed.length > 0 && <CompletedList completed={completed} compact />}

      <div>
        <Typography.Text strong style={{ fontSize: 13 }}>
          知识库名称
        </Typography.Text>
        <Input
          value={kbName}
          onChange={(e) => onKbNameChange(e.target.value)}
          placeholder={namePlaceholder ?? '输入一个好记的名字'}
          maxLength={128}
          style={{ marginTop: 4 }}
        />
      </div>

      <div>
        <Typography.Text strong style={{ fontSize: 13 }}>
          业务目标 <Typography.Text type="secondary" style={{ fontSize: 11 }}>· 从下拉选模板 · 或自己写 · 都可改</Typography.Text>
        </Typography.Text>

        {/* 行业模板下拉 */}
        <Select
          style={{ width: '100%', marginTop: 4 }}
          placeholder="🎯 从常用目标选一个 · 或自己写"
          showSearch
          allowClear
          optionFilterProp="label"
          onChange={(templateKey: string | undefined) => {
            if (!templateKey) return;
            const tmpl = GOAL_TEMPLATES.find((t) => t.label === templateKey);
            if (tmpl) {
              onGoalChange(buildGoalFromTemplate(tmpl.template, kbName));
            }
          }}
          options={GOAL_TEMPLATES.map((t) => ({
            value: t.label,
            label: `${t.icon}  ${t.label}`,
          }))}
        />

        <Input.TextArea
          value={goal}
          onChange={(e) => onGoalChange(e.target.value)}
          placeholder={goalPlaceholder}
          rows={2}
          maxLength={256}
          style={{ marginTop: 6 }}
        />
        {!goal.trim() && (
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            💡 留空的话 · 系统自动用 "让客户了解产品并留下联系方式" 兜底
          </Typography.Text>
        )}
      </div>

      <div>
        <Typography.Text strong style={{ fontSize: 13 }}>
          上传文档 <Typography.Text type="secondary" style={{ fontSize: 11 }}>· PDF / Word / txt / md</Typography.Text>
        </Typography.Text>
        <Upload.Dragger {...uploadProps} style={{ marginTop: 4, padding: '14px 0' }}>
          <p className="ant-upload-drag-icon" style={{ marginBottom: 4 }}>
            <InboxOutlined style={{ color: BRAND, fontSize: 30 }} />
          </p>
          <p style={{ fontSize: 13, fontWeight: 500, margin: 0 }}>
            拖拽文件到这里, 或点击选择
          </p>
          <p style={{ fontSize: 11, color: '#8c8c8c', margin: '4px 0 0' }}>
            可选多个 · 每个最大 20 MB
          </p>
        </Upload.Dragger>
        {files.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {files.map((f, i) => (
              <Tag
                key={i}
                closable
                color="success"
                onClose={() => onFilesChange(files.filter((_, idx) => idx !== i))}
                style={{ marginBottom: 4 }}
              >
                📄 {f.name}
              </Tag>
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          paddingTop: 4,
          borderTop: '1px solid #f0f0f0',
        }}
      >
        <a onClick={onBack} style={{ color: '#999' }}>
          ← 返回
        </a>
        <PrimaryBtn
          disabled={!kbName.trim() || files.length === 0}
          onClick={onNext}
        >
          建此 KB · 生成 FAQ →
        </PrimaryBtn>
      </div>
    </Space>
  );
}

function BuildProgress({ build }: { build: KbBuild }) {
  const steps = [
    { key: 'creating', label: '创建知识库' },
    { key: 'uploading', label: `上传 ${build.files.length} 个文件` },
    { key: 'generating', label: 'AI 生成 FAQ · 15-30 秒' },
    { key: 'done', label: '审核启用' },
  ];
  const currentIdx = steps.findIndex((s) => s.key === build.status);

  const pct = build.status === 'done'
    ? 100
    : build.status === 'creating' ? 15
    : build.status === 'uploading' ? 40
    : build.status === 'generating' ? 80
    : 0;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%', padding: '20px 0' }}>
      <div style={{ textAlign: 'center' }}>
        <LoadingOutlined style={{ fontSize: 36, color: BRAND }} />
        <Typography.Title level={5} style={{ margin: '12px 0 4px' }}>
          正在建立 "{build.name}"
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          请稍等 · 不要关闭窗口
        </Typography.Text>
      </div>

      <Progress
        percent={pct}
        strokeColor={{ from: BRAND, to: '#13c2c2' }}
        status={build.status === 'error' ? 'exception' : 'active'}
      />

      <div style={{ background: '#fafafa', padding: 12, borderRadius: 8 }}>
        {steps.map((s, i) => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
            {i < currentIdx ? (
              <CheckCircleFilled style={{ color: BRAND }} />
            ) : i === currentIdx ? (
              <LoadingOutlined style={{ color: BRAND }} />
            ) : (
              <span style={{ color: '#ccc' }}>○</span>
            )}
            <span
              style={{
                fontSize: 13,
                color: i <= currentIdx ? '#333' : '#bbb',
              }}
            >
              {s.label}
            </span>
          </div>
        ))}
      </div>

      {build.error && (
        <div style={{ color: '#f5222d', fontSize: 12 }}>
          ✗ {build.error}
        </div>
      )}
    </Space>
  );
}

function CompletedList({ completed, compact }: { completed: KbBuild[]; compact?: boolean }) {
  if (completed.length === 0) return null;
  return (
    <div
      style={{
        background: '#f7f7f7',
        border: '1px solid #e8e8e8',
        borderRadius: 8,
        padding: compact ? '8px 12px' : '12px 14px',
      }}
    >
      {!compact && (
        <Typography.Text strong style={{ fontSize: 12, color: '#666' }}>
          已完成 ({completed.length})
        </Typography.Text>
      )}
      <div style={{ marginTop: compact ? 0 : 6 }}>
        {completed.map((c, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 0',
              fontSize: 12,
            }}
          >
            <CheckCircleFilled style={{ color: BRAND, fontSize: 13 }} />
            <span style={{ fontWeight: 500 }}>{c.name}</span>
            <Tag
              color={c.kind === 'company' ? 'blue' : 'purple'}
              style={{ margin: 0, fontSize: 10, padding: '0 4px', lineHeight: '18px' }}
            >
              {c.kind === 'company' ? '公司通用' : '产品'}
            </Tag>
            <span style={{ color: '#999', fontSize: 11 }}>
              {c.files.length} 文档 · {c.faqCount ?? 0} FAQ
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────
// 公司通用表单 · 填充式 · 不是上传式
// ─────────────────────────────────────────

interface CompanyFields {
  companyName: string;
  address: string;
  whatsapp: string;
  email: string;
  website: string;
  facebook: string;
  telegram: string;
  businessHours: string;
}

function CompanyInfoForm({
  files,
  onFilesChange,
  uploadProps,
  onBack,
  onBuild,
  runningBuild,
  completed,
}: {
  files: File[];
  onFilesChange: (f: File[]) => void;
  uploadProps: UploadProps;
  onBack: () => void;
  onBuild: (text: string) => void;
  runningBuild: KbBuild | null;
  completed: KbBuild[];
}) {
  const [fields, setFields] = useState<CompanyFields>({
    companyName: '',
    address: '',
    whatsapp: '',
    email: '',
    website: '',
    facebook: '',
    telegram: '',
    businessHours: '',
  });

  const building =
    runningBuild?.status &&
    runningBuild.status !== 'done' &&
    runningBuild.status !== 'error';

  if (building) {
    return <BuildProgress build={runningBuild!} />;
  }

  const canNext = fields.companyName.trim().length > 0;

  const handleNext = () => {
    // 组装成 txt 内容
    const lines: string[] = [];
    lines.push(`公司名称: ${fields.companyName.trim()}`);
    if (fields.address.trim()) lines.push(`公司地址: ${fields.address.trim()}`);
    if (fields.businessHours.trim()) lines.push(`营业时间: ${fields.businessHours.trim()}`);
    lines.push('');
    lines.push('联系方式:');
    if (fields.whatsapp.trim()) lines.push(`· WhatsApp: ${fields.whatsapp.trim()}`);
    if (fields.email.trim()) lines.push(`· 邮箱: ${fields.email.trim()}`);
    if (fields.website.trim()) lines.push(`· 官网: ${fields.website.trim()}`);
    if (fields.facebook.trim()) lines.push(`· Facebook: ${fields.facebook.trim()}`);
    if (fields.telegram.trim()) lines.push(`· Telegram: ${fields.telegram.trim()}`);

    const text = lines.join('\n');
    onBuild(text);
  };

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <div style={{ textAlign: 'center', padding: '6px 0' }}>
        <BankOutlined style={{ color: BRAND, fontSize: 36 }} />
        <Typography.Title level={5} style={{ margin: '8px 0 4px' }}>
          建「公司通用」知识库
        </Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          填几个基本字段 · 系统帮你生成联系方式保留规则
        </Typography.Text>
      </div>

      {completed.length > 0 && <CompletedList completed={completed} compact />}

      {/* 基本信息 */}
      <div
        style={{
          padding: 14,
          border: '1px solid #eaeaea',
          borderRadius: 10,
          background: '#fafafa',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>📝 基本信息</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <LabeledInput
            label="公司名称"
            required
            placeholder="例: 星光解决方案"
            value={fields.companyName}
            onChange={(v) => setFields({ ...fields, companyName: v })}
          />
          <LabeledInput
            label="营业时间"
            placeholder="例: 周一至周六 09:00-18:00"
            value={fields.businessHours}
            onChange={(v) => setFields({ ...fields, businessHours: v })}
          />
        </div>
        <div style={{ marginTop: 10 }}>
          <LabeledInput
            label="公司地址"
            placeholder="例: Petaling Jaya, Selangor, Malaysia"
            value={fields.address}
            onChange={(v) => setFields({ ...fields, address: v })}
          />
        </div>
      </div>

      {/* 联系方式 */}
      <div
        style={{
          padding: 14,
          border: '1px solid #eaeaea',
          borderRadius: 10,
          background: '#fafafa',
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
          📞 联系方式 <Typography.Text type="secondary" style={{ fontSize: 11, fontWeight: 'normal' }}>
            · 能填多少就填多少 · AI 回复时会引导客户联系
          </Typography.Text>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <LabeledInput
            label="WhatsApp 号码"
            placeholder="例: 60123456789"
            value={fields.whatsapp}
            onChange={(v) => setFields({ ...fields, whatsapp: v })}
          />
          <LabeledInput
            label="邮箱"
            placeholder="例: sales@example.com"
            value={fields.email}
            onChange={(v) => setFields({ ...fields, email: v })}
          />
          <LabeledInput
            label="官网"
            placeholder="例: https://www.example.com"
            value={fields.website}
            onChange={(v) => setFields({ ...fields, website: v })}
          />
          <LabeledInput
            label="Facebook"
            placeholder="例: fb.com/yourpage"
            value={fields.facebook}
            onChange={(v) => setFields({ ...fields, facebook: v })}
          />
          <LabeledInput
            label="Telegram"
            placeholder="例: t.me/yourchannel"
            value={fields.telegram}
            onChange={(v) => setFields({ ...fields, telegram: v })}
          />
        </div>
      </div>

      {/* 可选文档上传 · 小区域 */}
      <div>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
          📎 <b>可选</b> · 如果你有公司介绍书 / 售后政策 / 退款条例等, 上传上来补充 AI 知识
          <Typography.Text type="secondary" style={{ fontSize: 11, marginLeft: 4 }}>
            (不上传也行)
          </Typography.Text>
        </div>
        <Upload {...uploadProps}>
          <Button icon={<InboxOutlined />} size="small">
            选择文件 (PDF / Word / txt · 可多个)
          </Button>
        </Upload>
        {files.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {files.map((f, i) => (
              <Tag
                key={i}
                closable
                color="success"
                onClose={() => onFilesChange(files.filter((_, idx) => idx !== i))}
                style={{ marginBottom: 4 }}
              >
                📄 {f.name}
              </Tag>
            ))}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          paddingTop: 4,
          borderTop: '1px solid #f0f0f0',
        }}
      >
        <a onClick={onBack} style={{ color: '#999' }}>
          ← 返回
        </a>
        <PrimaryBtn disabled={!canNext} onClick={handleNext}>
          建此 KB · 生成 FAQ →
        </PrimaryBtn>
      </div>
    </Space>
  );
}

function LabeledInput({
  label,
  placeholder,
  value,
  onChange,
  required,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#555', marginBottom: 3 }}>
        {label} {required && <span style={{ color: '#f5222d' }}>*</span>}
      </div>
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        size="small"
      />
    </div>
  );
}

function PrimaryBtn({
  onClick,
  disabled,
  loading,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="primary"
      onClick={onClick}
      disabled={disabled}
      loading={loading}
      style={{
        background: disabled ? '#ccc' : BRAND,
        borderColor: disabled ? '#ccc' : BRAND,
        fontWeight: 600,
      }}
    >
      {children}
    </Button>
  );
}

// ── 步骤编号工具 ────────────────────────

function getStepNumber(
  step: WizardStep,
  multi: boolean | null,
  productIdx: number,
  productDone: number,
  hasExistingCompany: boolean,
): number {
  // 无 existing: welcome=1, company=2, product=2+idx, addMore, enableMode, done
  // 有 existing: welcome=1, product=1+idx (跳过 company), addMore, enableMode, done
  if (hasExistingCompany) {
    if (step === 'welcome') return 1;
    if (step === 'product') return 1 + productIdx;
    if (step === 'addMore') return 1 + Math.max(productDone, 1);
    if (step === 'enableMode') return multi ? 4 : 3;
    if (step === 'done') return multi ? 5 : 4;
    return 1;
  }
  if (step === 'welcome') return 1;
  if (step === 'company') return 2;
  if (step === 'product') return 2 + productIdx;
  if (step === 'addMore') return 2 + Math.max(productDone, 1);
  if (step === 'enableMode') return (multi ? 5 : 4);
  if (step === 'done') return (multi ? 6 : 5);
  return 1;
}

function totalSteps(multi: boolean, hasExistingCompany: boolean): number {
  // 单: welcome + company + product + enable + done = 5
  // 多: welcome + company + 3 products (estimate) + enable + done = 7 (但我们用动态)
  // 有 existing 时少一步 company
  if (hasExistingCompany) return multi ? 5 : 4;
  return multi ? 6 : 5;
}
