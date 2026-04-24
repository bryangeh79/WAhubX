import { useEffect, useState } from 'react';
import {
  App,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { openingLinesApi, type OpeningLine, type OpeningVariant } from '@/lib/campaigns-api';
import { extractErrorMessage } from '@/lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function OpeningLineDrawer({ open, onClose }: Props) {
  const { message } = App.useApp();
  const [items, setItems] = useState<OpeningLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<OpeningLine | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      setItems(await openingLinesApi.list());
    } catch (err) {
      message.error(extractErrorMessage(err, '加载开场白失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void reload();
  }, [open]);

  return (
    <Drawer
      title="开场白库"
      open={open}
      onClose={onClose}
      width={560}
      extra={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditing(null);
            setCreating(true);
          }}
        >
          新建开场白
        </Button>
      }
    >
      {loading && items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40 }}>加载中...</div>
      ) : items.length === 0 ? (
        <Empty description="还没有开场白" />
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {items.map((row) => (
            <div
              key={row.id}
              style={{
                border: '1px solid #e8e8e8',
                borderRadius: 8,
                padding: 14,
                background: '#fff',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 10,
                  marginBottom: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: 34,
                      height: 22,
                      padding: '0 8px',
                      background: '#f0faf4',
                      color: '#25d366',
                      border: '1px solid #b7eb8f',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      fontFamily: 'Menlo, Consolas, monospace',
                    }}
                  >
                    #{row.id}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{row.name}</span>
                  {row.status === 1 ? (
                    <Tag color="green" style={{ margin: 0 }}>启用</Tag>
                  ) : (
                    <Tag style={{ margin: 0 }}>已禁用</Tag>
                  )}
                  {row.aiEnabled && (row.variants?.length ?? 0) === 0 && (
                    <Tooltip title="AI 变体池开了但没生成 · 发送仍用原文">
                      <Tag color="orange" icon={<ThunderboltOutlined />} style={{ margin: 0 }}>
                        AI 待生成
                      </Tag>
                    </Tooltip>
                  )}
                  {row.aiEnabled && (row.variants?.length ?? 0) > 0 && (
                    <Tooltip title={`变体编号: ${row.id}.1 ~ ${row.id}.${row.variants.length}`}>
                      <Tag color="purple" icon={<ThunderboltOutlined />} style={{ margin: 0 }}>
                        AI · {row.variants.length} 变体
                      </Tag>
                    </Tooltip>
                  )}
                </div>
                <Space size={0} split={<span style={{ color: '#e0e0e0' }}>|</span>}>
                  <Button
                    type="link"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setEditing(row);
                      setCreating(true);
                    }}
                    style={{ padding: '0 8px' }}
                  >
                    编辑
                  </Button>
                  <Popconfirm
                    title="删除这条开场白?"
                    onConfirm={async () => {
                      try {
                        await openingLinesApi.remove(row.id);
                        message.success('已删除');
                        await reload();
                      } catch (err) {
                        message.error(extractErrorMessage(err, '删除失败'));
                      }
                    }}
                  >
                    <Button
                      type="link"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      style={{ padding: '0 8px' }}
                    >
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              </div>
              <div
                style={{
                  color: '#555',
                  fontSize: 13,
                  lineHeight: 1.6,
                  borderTop: '1px dashed #f0f0f0',
                  paddingTop: 8,
                }}
              >
                {row.content}
              </div>
            </div>
          ))}
        </Space>
      )}

      {creating && (
        <OpeningEditorModal
          editing={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={async () => {
            setCreating(false);
            setEditing(null);
            await reload();
          }}
        />
      )}
    </Drawer>
  );
}

// ──────────────────────────────────────────────────────────────

function OpeningEditorModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: OpeningLine | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message, modal } = App.useApp();
  const [name, setName] = useState(editing?.name ?? '');
  const [content, setContent] = useState(editing?.content ?? '');
  const [aiEnabled, setAiEnabled] = useState(editing?.aiEnabled ?? false);
  const [variants, setVariants] = useState<OpeningVariant[]>(editing?.variants ?? []);
  const [recordId, setRecordId] = useState<number | null>(editing?.id ?? null);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  const isEdit = recordId !== null;

  const handleSave = async () => {
    if (!name.trim()) return message.warning('请输入名称');
    if (!content.trim()) return message.warning('请输入内容');
    setSaving(true);
    try {
      if (recordId !== null) {
        await openingLinesApi.update(recordId, { name, content, aiEnabled, variants });
        message.success('已保存');
      } else {
        await openingLinesApi.create({ name, content, aiEnabled });
        message.success('已创建');
      }
      onSaved();
    } catch (err) {
      message.error(extractErrorMessage(err, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const runGenerate = async (append: boolean, idOverride?: number) => {
    const id = idOverride ?? recordId;
    if (id === null) return;
    setGenerating(true);
    try {
      if (editing && content !== editing.content) {
        await openingLinesApi.update(id, { content });
      }
      const updated = await openingLinesApi.generateVariants(id, 10, append);
      setVariants(updated.variants);
      setAiEnabled(updated.aiEnabled);
      message.success(
        append
          ? `已追加 ${updated.variants.length - variants.length} 条变体 · 池共 ${updated.variants.length} 条`
          : `已生成 ${updated.variants.length} 条变体`,
      );
    } catch (err) {
      message.error(extractErrorMessage(err, 'AI 生成失败'));
    } finally {
      setGenerating(false);
    }
  };

  // 2026-04-24 · 确保有 recordId (新建时自动 create)
  const ensureRecord = async (): Promise<number | null> => {
    if (recordId !== null) return recordId;
    if (!name.trim()) {
      message.warning('请先填写名称');
      return null;
    }
    if (!content.trim()) {
      message.warning('请先填写内容');
      return null;
    }
    try {
      const created = await openingLinesApi.create({ name, content, aiEnabled: true });
      setRecordId(created.id);
      message.info(`已自动保存开场白 #${created.id} · 准备生成变体...`);
      return created.id;
    } catch (err) {
      message.error(extractErrorMessage(err, '自动保存失败'));
      return null;
    }
  };

  const handleGenerate = async () => {
    const id = await ensureRecord();
    if (id === null) return;
    await runGenerate(false, id);
  };

  const handleAppendGenerate = async () => {
    const id = await ensureRecord();
    if (id === null) return;
    if (variants.length >= 30) {
      message.warning('变体池已达上限 30 条');
      return;
    }
    await runGenerate(true, id);
  };

  const handleToggleAi = (v: boolean) => {
    setAiEnabled(v);
    if (!v) return;
    const variantsEmpty = variants.filter((vv) => vv.content.trim()).length === 0;
    if (!variantsEmpty) return;
    if (!name.trim() || !content.trim()) {
      message.info('AI 已开启 · 填完名称 + 内容后点"生成 10 条变体"按钮');
      return;
    }
    modal.confirm({
      title: '现在生成 10 条 AI 变体?',
      content: isEdit
        ? '将用 AI 为当前开场白生成 10 条变体 · 约 5-15 秒'
        : '会先自动保存这条开场白 · 然后用 AI 生成 10 条变体 · 约 5-15 秒',
      okText: '开始生成',
      cancelText: '先不生成',
      okButtonProps: { style: { background: '#25d366', borderColor: '#25d366' } },
      onOk: () => handleGenerate(),
    });
  };

  const handleRegenerateAll = () => {
    if (recordId === null) return;
    modal.confirm({
      title: `重新生成会覆盖现有 ${variants.length} 条变体?`,
      content: '全部现有变体 (包括你手动改过的) 都会被替换成新的 10 条.',
      okText: '确认重新生成',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => runGenerate(false, recordId),
    });
  };

  const updateVariant = (idx: number, patch: Partial<OpeningVariant>) => {
    setVariants((prev) => prev.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  };

  const removeVariant = (idx: number) => {
    setVariants((prev) => prev.filter((_, i) => i !== idx).map((v, i) => ({ ...v, index: i + 1 })));
  };

  const addVariant = () => {
    setVariants((prev) => [
      ...prev,
      { index: prev.length + 1, content: '', enabled: true },
    ]);
  };

  return (
    <Modal
      open={true}
      title={editing ? `编辑开场白 · ${editing.name}` : recordId !== null ? `编辑开场白 #${recordId}` : '新建开场白'}
      onCancel={onClose}
      width={640}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onClose} disabled={saving}>
          取消
        </Button>,
        <Button
          key="save"
          type="primary"
          onClick={handleSave}
          loading={saving}
          style={{ background: '#25d366', borderColor: '#25d366' }}
        >
          保存
        </Button>,
      ]}
    >
      <Form layout="vertical">
        <Form.Item label="名称" required>
          <Input
            placeholder="例如: 日常问候 A"
            maxLength={50}
            showCount
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Form.Item>

        <Form.Item
          label="内容"
          required
          extra={
            <span style={{ color: '#8c8c8c', fontSize: 12 }}>
              发送广告时会拼在广告文案前面 · 开启 AI 变体池后每次随机抽一条
            </span>
          }
        >
          <Input.TextArea
            rows={3}
            maxLength={512}
            showCount
            placeholder="例如: 你好 · 打扰一下..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </Form.Item>

        {/* AI 变体池 */}
        <Form.Item>
          <div
            style={{
              border: '1px solid #e0e0e0',
              borderRadius: 8,
              padding: 16,
              background: aiEnabled ? '#f6fff0' : '#fafafa',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <Space>
                <ThunderboltOutlined style={{ color: '#25d366' }} />
                <span style={{ fontWeight: 600 }}>AI 变体池</span>
                <Tooltip title="开启后系统会生成多条不同表达的开场白. 发送时随机抽 1 条, 降低封号风险.">
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    (推荐 · 防封号)
                  </Typography.Text>
                </Tooltip>
              </Space>
              <Switch checked={aiEnabled} onChange={handleToggleAi} />
            </div>

            {aiEnabled && (
              <>
                <Space style={{ marginBottom: 12 }} wrap>
                  {variants.length === 0 ? (
                    <Button
                      type="primary"
                      icon={<ThunderboltOutlined />}
                      loading={generating}
                      onClick={handleGenerate}
                      style={{ background: '#25d366', borderColor: '#25d366' }}
                    >
                      AI 生成 10 条变体
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        loading={generating}
                        onClick={handleAppendGenerate}
                        disabled={variants.length >= 30}
                        style={{ background: '#25d366', borderColor: '#25d366' }}
                      >
                        再加 10 条 ({variants.length}/30)
                      </Button>
                      <Button
                        icon={<ReloadOutlined />}
                        loading={generating}
                        onClick={handleRegenerateAll}
                      >
                        重新生成
                      </Button>
                    </>
                  )}
                  <Button icon={<PlusOutlined />} onClick={addVariant} disabled={generating}>
                    手动增加
                  </Button>
                </Space>
                {!isEdit && variants.length === 0 && (
                  <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
                    点上方按钮会自动保存开场白并生成变体 (需先填名称和内容)
                  </Typography.Text>
                )}

                {generating ? (
                  <div style={{ textAlign: 'center', padding: 20 }}>
                    <Spin tip="AI 正在生成 · 约 5-15 秒" />
                  </div>
                ) : variants.length === 0 ? (
                  <Empty
                    description={
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        还没有变体 · 点上方按钮生成
                      </Typography.Text>
                    }
                    imageStyle={{ height: 40 }}
                  />
                ) : (
                  <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                    {variants.map((v, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          gap: 8,
                          padding: '6px 0',
                          borderBottom: i < variants.length - 1 ? '1px solid #f0f0f0' : 'none',
                          alignItems: 'flex-start',
                        }}
                      >
                        <Tag
                          color={v.enabled ? 'green' : 'default'}
                          style={{
                            fontWeight: 600,
                            cursor: 'pointer',
                            minWidth: 48,
                            textAlign: 'center',
                          }}
                          onClick={() => updateVariant(i, { enabled: !v.enabled })}
                        >
                          {recordId !== null ? `${recordId}.${v.index}` : `#${v.index}`}
                        </Tag>
                        <Input
                          value={v.content}
                          onChange={(e) => updateVariant(i, { content: e.target.value })}
                          style={{
                            flex: 1,
                            background: v.enabled ? '#fff' : '#fafafa',
                            color: v.enabled ? '#333' : '#bfbfbf',
                          }}
                        />
                        <Button
                          type="text"
                          danger
                          icon={<DeleteOutlined />}
                          onClick={() => removeVariant(i)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </Form.Item>
      </Form>
    </Modal>
  );
}
