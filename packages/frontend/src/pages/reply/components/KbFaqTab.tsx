// 2026-04-24 · FAQ 管理 · AI 生成 + 手动添加 + 批量上传
import { useEffect, useState } from 'react';
import {
  App,
  Alert,
  Button,
  Dropdown,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd';
import type { UploadProps } from 'antd';
import {
  CheckCircleOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  PlusOutlined,
  ThunderboltFilled,
  UploadOutlined,
} from '@ant-design/icons';
import * as XLSX from 'xlsx';
import {
  kbApi,
  type FaqStatus,
  type KbFaq,
} from '@/lib/intelligent-reply-api';
import { extractErrorMessage } from '@/lib/api';

const BRAND = '#25d366';

interface Props {
  kbId: number;
  onChanged: () => void;
}

type FilterKey = 'all' | 'draft' | 'enabled' | 'disabled';

export function KbFaqTab({ kbId, onChanged }: Props) {
  const { message, modal } = App.useApp();
  const [faqs, setFaqs] = useState<KbFaq[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<KbFaq | null>(null);
  const [generating, setGenerating] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [customizing, setCustomizing] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      setFaqs(await kbApi.listFaqs(kbId));
    } catch (err) {
      message.error(extractErrorMessage(err, '加载失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbId]);

  const filtered = faqs.filter((f) => filter === 'all' || f.status === filter);
  const draftCount = faqs.filter((f) => f.status === 'draft').length;
  const enabledCount = faqs.filter((f) => f.status === 'enabled').length;

  // AI 生成
  const handleGenerate = async () => {
    modal.confirm({
      title: 'AI 自动生成 FAQ',
      content:
        '系统调用平台 AI (DeepSeek) 基于你的文档生成 30 条 Q/A · 默认待审核状态 · 审核通过后才参与自动回复 · 大约 10-30 秒',
      okText: '开始生成',
      okButtonProps: { style: { background: BRAND, borderColor: BRAND } },
      onOk: async () => {
        setGenerating(true);
        try {
          const res = await kbApi.generateFaqs(kbId, 30);
          message.success(`已生成 ${res.generated} 条 · 跳重复 ${res.skippedDup}`);
          await reload();
          onChanged();
        } catch (err) {
          message.error(extractErrorMessage(err, '生成失败'));
        } finally {
          setGenerating(false);
        }
      },
    });
  };

  const handleApproveAll = async () => {
    try {
      const res = await kbApi.approveAllDrafts(kbId);
      message.success(`已审核通过 ${res.updated} 条`);
      await reload();
      onChanged();
    } catch (err) {
      message.error(extractErrorMessage(err, '操作失败'));
    }
  };

  // 2026-04-28 · 灌入 52 条通用 starter FAQ (问候/身份/转人工等共性问题)
  const handleSeedCommon = () => {
    modal.confirm({
      title: '灌入 52 条通用 FAQ',
      content: (
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <div>包含 12 类通用客服问答:</div>
          <div style={{ marginTop: 6, color: '#666' }}>
            问候 · 身份 · 营业时间 · 联系方式 · 价格咨询 · 产品介绍 · 优惠活动 ·
            订单物流 · 退款售后 · 投诉 · 转人工 · 道别感谢
          </div>
          <div style={{ marginTop: 8, color: '#fa8c16' }}>
            ⚠ 已存在的 question 会跳过 (idempotent · 重复点没坏处)
          </div>
        </div>
      ),
      okText: '灌入',
      onOk: async () => {
        setSeeding(true);
        try {
          const res = await kbApi.seedCommonFaqs(kbId);
          message.success(`已灌入 ${res.inserted} 条 · 跳重复 ${res.skipped} 条`);
          await reload();
          onChanged();
        } catch (err) {
          message.error(extractErrorMessage(err, '灌入失败'));
        } finally {
          setSeeding(false);
        }
      },
    });
  };

  // 2026-04-28 · 用租户 AI 把 starter FAQ 改写得贴合公司业务
  // 2026-04-29 · V2.4 · 加 force 路径
  //   场景 1 (首次): KB 里 starter FAQ 还没被 customized · 走旧逻辑 (force=false)
  //   场景 2 (重新优化): 已有 starter-customized FAQ · 弹"覆盖确认" modal · force=true
  const handleCustomizeStarter = () => {
    // 检测是否已有 customized starter FAQ (老答案可能含产品名硬编码)
    const customizedCount = faqs.filter(
      (f) =>
        Array.isArray(f.tags) &&
        f.tags.includes('starter') &&
        f.tags.includes('starter-customized'),
    ).length;
    const hasCustomized = customizedCount > 0;

    const runCustomize = async (force: boolean) => {
      setCustomizing(true);
      try {
        const res = await kbApi.customizeStarterFaqs(kbId, { force });
        if (res.failed > 0) {
          message.warning(`AI 优化完成 · 成功 ${res.updated} 条 · 失败 ${res.failed} 条`);
        } else if (res.updated === 0) {
          message.info(
            force
              ? `没有可优化的 starter FAQ`
              : `所有 starter FAQ 都已优化过 · 如需重新优化请再点一次按钮`,
          );
        } else {
          message.success(
            force
              ? `重新优化完成 · ${res.updated} 条 starter FAQ 已覆盖`
              : `AI 优化完成 · ${res.updated} 条 starter FAQ 已贴合业务`,
          );
        }
        await reload();
        onChanged();
      } catch (err) {
        message.error(extractErrorMessage(err, 'AI 优化失败 · 请确认已配 AI Key'));
      } finally {
        setCustomizing(false);
      }
    };

    if (hasCustomized) {
      // 场景 2: 二次确认 modal (覆盖现有)
      modal.confirm({
        title: '重新优化已优化过的通用 FAQ?',
        content: (
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            <div>
              检测到 <strong style={{ color: '#fa8c16' }}>{customizedCount} 条</strong> 已被 AI 优化过的 starter FAQ.
            </div>
            <div style={{ marginTop: 8 }}>
              这会<strong style={{ color: '#cf1322' }}>重新调 AI 优化</strong>这些 FAQ ·
              <strong style={{ color: '#cf1322' }}>覆盖旧回答</strong>.
            </div>
            <div style={{ marginTop: 8, color: '#666' }}>
              使用场景: 老 customize 答案含写死的产品名 / 旧风格 · 想用最新 sanity check + variants 重写.
            </div>
            <div style={{ marginTop: 8, color: '#1677ff' }}>
              约 1-3 分钟 · 费用按你的 AI 套餐扣 · 此操作不可撤销.
            </div>
          </div>
        ),
        okText: '确认重新优化（覆盖）',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: async () => runCustomize(true),
      });
    } else {
      // 场景 1: 首次优化 modal (旧行为)
      modal.confirm({
        title: '用 AI 优化通用 FAQ',
        content: (
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            <div>系统会根据你的<strong>产品 KB 描述</strong>调用你配的 AI · 改写每条 starter FAQ 答案让它更贴合公司业务.</div>
            <div style={{ marginTop: 6, color: '#666' }}>
              前提: 在 设置 → AI 配置 已填 API Key (DeepSeek / OpenAI / 等)
            </div>
            <div style={{ marginTop: 8, color: '#1677ff' }}>
              约 1-3 分钟 · 处理 50 条 · 费用按你的 AI 套餐扣
            </div>
          </div>
        ),
        okText: '开始 AI 优化',
        okButtonProps: { type: 'primary' },
        onOk: async () => runCustomize(false),
      });
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await kbApi.removeFaq(kbId, id);
      message.success('已删除');
      await reload();
      onChanged();
    } catch (err) {
      message.error(extractErrorMessage(err, '删除失败'));
    }
  };

  const handleStatusChange = async (faq: KbFaq, status: FaqStatus) => {
    try {
      await kbApi.updateFaq(kbId, faq.id, { status });
      message.success('已更新');
      await reload();
      onChanged();
    } catch (err) {
      message.error(extractErrorMessage(err, '更新失败'));
    }
  };

  // 批量上传
  const bulkUpload: UploadProps = {
    accept: '.csv,.xlsx,.xls,.json,.txt',
    showUploadList: false,
    beforeUpload: async (file) => {
      try {
        const items = await parseFaqFile(file as unknown as File);
        if (items.length === 0) {
          message.warning('文件解析出 0 条');
          return false;
        }
        const res = await kbApi.bulkImport(kbId, items);
        message.success(
          `导入 ${res.added} 条 · 跳重复 ${res.skippedDup} · 无效 ${res.skippedInvalid}`,
        );
        await reload();
        onChanged();
      } catch (err) {
        message.error(extractErrorMessage(err, '上传失败'));
      }
      return false;
    },
  };

  const downloadTemplate = () => {
    const csv = '\ufefffiles\n';
    const content =
      '\ufeffquestion,answer,tags\n' +
      '"你们主要做什么?","我们是马来西亚本土跨境支付服务商...","基础"\n' +
      '"怎么联系?","可以 WhatsApp +60123456789 · 官网 www.example.my","联系"\n';
    void csv;
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'faq-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="FAQ 是客户自动回复的优先来源 · 命中就直接回 · 没有的问题再走 AI"
      />

      {/* 顶部操作条 */}
      <Space wrap>
        <Button
          type="primary"
          icon={<ThunderboltFilled />}
          onClick={handleGenerate}
          loading={generating}
          style={{ background: BRAND, borderColor: BRAND }}
        >
          AI 生成 30 条
        </Button>
        <Upload {...bulkUpload}>
          <Button icon={<UploadOutlined />}>批量上传 Excel/CSV</Button>
        </Upload>
        <Button
          icon={<DownloadOutlined />}
          onClick={downloadTemplate}
          size="small"
          type="link"
        >
          下载模板
        </Button>
        <Button
          icon={<PlusOutlined />}
          onClick={() => {
            setEditing(null);
            setEditOpen(true);
          }}
        >
          手动添加
        </Button>
        {draftCount > 0 && (
          <Popconfirm
            title={`一键审核通过 ${draftCount} 条待审 FAQ?`}
            onConfirm={handleApproveAll}
          >
            <Button icon={<CheckCircleOutlined />} type="dashed">
              审核全部草稿
            </Button>
          </Popconfirm>
        )}
        {/* 2026-04-28 · 通用 FAQ starter (问候/身份/转人工等 52 条) */}
        <Button
          icon={<span>🌟</span>}
          onClick={handleSeedCommon}
          loading={seeding}
          style={{ borderColor: '#faad14', color: '#fa8c16' }}
        >
          灌入通用 FAQ (52 条)
        </Button>
        <Button
          icon={<span>🤖</span>}
          onClick={handleCustomizeStarter}
          loading={customizing}
          style={{ borderColor: '#1677ff', color: '#1677ff' }}
        >
          AI 优化通用 FAQ
        </Button>
      </Space>

      {/* 过滤 */}
      <Radio.Group
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        buttonStyle="solid"
      >
        <Radio.Button value="all">全部 {faqs.length}</Radio.Button>
        <Radio.Button value="enabled">
          <span style={{ color: filter === 'enabled' ? '#fff' : BRAND }}>
            ✓ 启用 {enabledCount}
          </span>
        </Radio.Button>
        <Radio.Button value="draft">
          <span style={{ color: filter === 'draft' ? '#fff' : '#fa8c16' }}>
            ⏳ 草稿 {draftCount}
          </span>
        </Radio.Button>
        <Radio.Button value="disabled">
          停用 {faqs.filter((f) => f.status === 'disabled').length}
        </Radio.Button>
      </Radio.Group>

      {/* 列表 */}
      <Table
        size="small"
        rowKey="id"
        loading={loading}
        dataSource={filtered}
        columns={[
          {
            title: '问题',
            dataIndex: 'question',
            render: (v: string, row: KbFaq) => (
              <div>
                <div>{v}</div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                  {row.answer.slice(0, 80)}
                  {row.answer.length > 80 ? '...' : ''}
                </div>
              </div>
            ),
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 90,
            render: (s: FaqStatus) =>
              s === 'enabled' ? (
                <Tag color="success">启用</Tag>
              ) : s === 'draft' ? (
                <Tag color="warning">草稿</Tag>
              ) : (
                <Tag>停用</Tag>
              ),
          },
          {
            title: '来源',
            dataIndex: 'source',
            width: 110,
            render: (s: string) =>
              s === 'ai_generated' ? (
                <Tag color="purple">AI 生成</Tag>
              ) : s === 'manual_bulk' ? (
                <Tag color="blue">批量</Tag>
              ) : (
                <Tag>手动</Tag>
              ),
          },
          {
            title: '命中',
            dataIndex: 'hitCount',
            width: 70,
            align: 'right',
          },
          {
            title: '操作',
            width: 110,
            render: (_: unknown, row: KbFaq) => (
              <Space size={4}>
                <Button
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setEditing(row);
                    setEditOpen(true);
                  }}
                />
                <Dropdown
                  menu={{
                    items: [
                      {
                        key: 'enable',
                        label: '启用',
                        disabled: row.status === 'enabled',
                        onClick: () => handleStatusChange(row, 'enabled'),
                      },
                      {
                        key: 'disable',
                        label: '停用',
                        disabled: row.status === 'disabled',
                        onClick: () => handleStatusChange(row, 'disabled'),
                      },
                      { type: 'divider' },
                      {
                        key: 'del',
                        danger: true,
                        label: (
                          <Popconfirm
                            title="删除此 FAQ?"
                            onConfirm={() => handleDelete(row.id)}
                          >
                            <span>
                              <DeleteOutlined /> 删除
                            </span>
                          </Popconfirm>
                        ),
                      },
                    ],
                  }}
                  trigger={['click']}
                >
                  <Button type="link" size="small">
                    更多
                  </Button>
                </Dropdown>
              </Space>
            ),
          },
        ]}
        pagination={{ pageSize: 20 }}
        locale={{
          emptyText: (
            <div style={{ padding: 24, color: '#999' }}>
              {filter === 'all' ? '还没有 FAQ · 点 AI 生成或批量上传' : '无匹配'}
            </div>
          ),
        }}
      />

      {/* 编辑 Modal */}
      <FaqEditModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={async () => {
          setEditOpen(false);
          await reload();
          onChanged();
        }}
        kbId={kbId}
        editing={editing}
      />
    </Space>
  );
}

// ── FAQ 解析 (CSV/Excel/JSON/结构化文本) ─────────

async function parseFaqFile(
  file: File,
): Promise<Array<{ question: string; answer: string; tags?: string[] }>> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.json')) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('JSON 必须是数组');
    return parsed.map((p: { q?: string; a?: string; question?: string; answer?: string; tags?: string[] }) => ({
      question: p.q ?? p.question ?? '',
      answer: p.a ?? p.answer ?? '',
      tags: p.tags ?? [],
    }));
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    return rows.map((r) => ({
      question: String(r.question ?? r.q ?? r.Q ?? r['问题'] ?? ''),
      answer: String(r.answer ?? r.a ?? r.A ?? r['回答'] ?? ''),
      tags: typeof r.tags === 'string' ? String(r.tags).split(/[;,]/).map((t) => t.trim()).filter(Boolean) : [],
    }));
  }
  if (name.endsWith('.csv')) {
    const text = await file.text();
    return parseCsv(text);
  }
  // .txt 结构化: Q: ... A: ... 空行分隔
  const text = await file.text();
  return parseStructuredText(text);
}

function parseCsv(text: string): Array<{ question: string; answer: string; tags?: string[] }> {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  // 简单 CSV (不处理带引号的 , 分隔值)
  const header = lines[0].toLowerCase().split(',').map((h) => h.trim());
  const qIdx = header.findIndex((h) => h === 'question' || h === 'q' || h === '问题');
  const aIdx = header.findIndex((h) => h === 'answer' || h === 'a' || h === '回答');
  const tIdx = header.findIndex((h) => h === 'tags' || h === 'tag');
  const out: Array<{ question: string; answer: string; tags?: string[] }> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const q = (qIdx >= 0 ? cells[qIdx] : cells[0])?.trim().replace(/^"|"$/g, '') ?? '';
    const a = (aIdx >= 0 ? cells[aIdx] : cells[1])?.trim().replace(/^"|"$/g, '') ?? '';
    const tagsRaw = (tIdx >= 0 ? cells[tIdx] : '')?.trim().replace(/^"|"$/g, '') ?? '';
    const tags = tagsRaw ? tagsRaw.split(/[;,|]/).map((t) => t.trim()).filter(Boolean) : [];
    if (q && a) out.push({ question: q, answer: a, tags });
  }
  return out;
}

function parseStructuredText(text: string): Array<{ question: string; answer: string }> {
  const blocks = text.split(/\n\s*\n/);
  const out: Array<{ question: string; answer: string }> = [];
  for (const b of blocks) {
    const qMatch = b.match(/^Q:\s*(.+)$/im);
    const aMatch = b.match(/^A:\s*([\s\S]+)$/im);
    if (qMatch && aMatch) {
      out.push({
        question: qMatch[1].trim(),
        answer: aMatch[1].trim().split(/\nQ:/)[0].trim(),
      });
    }
  }
  return out;
}

// ── FAQ 编辑 Modal ─────────

function FaqEditModal({
  open,
  onClose,
  onSaved,
  kbId,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  kbId: number;
  editing: KbFaq | null;
}) {
  const { message } = App.useApp();
  const [q, setQ] = useState('');
  const [a, setA] = useState('');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setQ(editing?.question ?? '');
      setA(editing?.answer ?? '');
      setTags((editing?.tags ?? []).join(', '));
    }
  }, [open, editing]);

  const save = async () => {
    if (!q.trim() || !a.trim()) {
      message.warning('问题和回答都要填');
      return;
    }
    setSaving(true);
    try {
      const tagList = tags
        .split(/[,;|]/)
        .map((t) => t.trim())
        .filter(Boolean);
      if (editing) {
        await kbApi.updateFaq(kbId, editing.id, { question: q, answer: a, tags: tagList });
      } else {
        await kbApi.createFaq(kbId, { question: q, answer: a, tags: tagList });
      }
      message.success('已保存');
      onSaved();
    } catch (err) {
      message.error(extractErrorMessage(err, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={editing ? '编辑 FAQ' : '手动添加 FAQ'}
      open={open}
      onCancel={onClose}
      onOk={save}
      confirmLoading={saving}
      okText="保存"
      okButtonProps={{ style: { background: BRAND, borderColor: BRAND } }}
      destroyOnHidden
      width={620}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <Typography.Text strong>问题</Typography.Text>
          <Input.TextArea
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="例: 你们家产品多少钱?"
            autoSize={{ minRows: 2 }}
            maxLength={500}
            showCount
          />
        </div>
        <div>
          <Typography.Text strong>回答</Typography.Text>
          <Input.TextArea
            value={a}
            onChange={(e) => setA(e.target.value)}
            placeholder="例: 价格根据你需求安排, 可以先告诉我大概规模, 我帮你问 👌"
            autoSize={{ minRows: 3, maxRows: 8 }}
            maxLength={2000}
            showCount
          />
        </div>
        <div>
          <Typography.Text strong>标签</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
            (可选 · 逗号分隔)
          </Typography.Text>
          <Input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="价格, 咨询"
          />
        </div>
      </div>
    </Modal>
  );
}
