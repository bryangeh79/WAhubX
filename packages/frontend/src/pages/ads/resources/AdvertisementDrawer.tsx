import { useEffect, useState } from 'react';
import {
  App,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import type { UploadProps } from 'antd';
import {
  CloseCircleFilled,
  DeleteOutlined,
  EditOutlined,
  FileOutlined,
  PictureOutlined,
  PlusOutlined,
  ReloadOutlined,
  SoundOutlined,
  ThunderboltOutlined,
  UploadOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { adsApi, type AdVariant, type Advertisement } from '@/lib/campaigns-api';
import { api, extractErrorMessage } from '@/lib/api';

type AssetKind = 'image' | 'video' | 'voice' | 'file' | 'sticker';

interface AssetPreviewMeta {
  id: number;
  kind: AssetKind;
  filename?: string;
}

function detectAssetKind(file: File): AssetKind {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'voice';
  return 'file';
}

function AssetPreview({
  meta,
  assetId,
  onRemove,
}: {
  meta: AssetPreviewMeta | null;
  assetId: number;
  onRemove: () => void;
}) {
  const fileUrl = `/api/v1/assets/file/${assetId}`;
  const kind = meta?.kind ?? 'file';
  const label = meta?.filename || `素材 #${assetId}`;

  const kindTag =
    kind === 'image' ? (
      <Tag color="blue" icon={<PictureOutlined />}>
        图片
      </Tag>
    ) : kind === 'video' ? (
      <Tag color="purple" icon={<VideoCameraOutlined />}>
        视频
      </Tag>
    ) : kind === 'voice' ? (
      <Tag color="orange" icon={<SoundOutlined />}>
        语音
      </Tag>
    ) : (
      <Tag icon={<FileOutlined />}>文件</Tag>
    );

  return (
    <div
      style={{
        display: 'flex',
        gap: 14,
        padding: 12,
        border: '1px solid #e8e8e8',
        borderRadius: 8,
        background: '#fafafa',
        position: 'relative',
        alignItems: 'center',
      }}
    >
      {/* 缩略图区 */}
      <div
        style={{
          width: 100,
          height: 100,
          borderRadius: 6,
          overflow: 'hidden',
          background: '#fff',
          border: '1px solid #e0e0e0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {kind === 'image' && (
          <img
            src={fileUrl}
            alt={label}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'cover' }}
          />
        )}
        {kind === 'video' && (
          <video src={fileUrl} style={{ maxWidth: '100%', maxHeight: '100%' }} controls={false} muted />
        )}
        {kind === 'voice' && <SoundOutlined style={{ fontSize: 40, color: '#fa8c16' }} />}
        {(kind === 'file' || kind === 'sticker') && (
          <FileOutlined style={{ fontSize: 40, color: '#8c8c8c' }} />
        )}
      </div>

      {/* 信息区 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '2px 8px',
              background: '#f0faf4',
              color: '#25d366',
              border: '1px solid #b7eb8f',
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'Menlo, Consolas, monospace',
            }}
          >
            #{assetId}
          </span>
          {kindTag}
        </div>
        <div
          style={{
            fontSize: 13,
            color: '#333',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={label}
        >
          {label}
        </div>
        {kind === 'voice' && (
          <audio src={fileUrl} controls style={{ width: '100%', height: 32, marginTop: 6 }} />
        )}
      </div>

      {/* 删除按钮 */}
      <Tooltip title="移除附件">
        <Button
          type="text"
          icon={<CloseCircleFilled style={{ color: '#bfbfbf', fontSize: 18 }} />}
          onClick={onRemove}
          style={{ flexShrink: 0 }}
        />
      </Tooltip>
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function AdvertisementDrawer({ open, onClose }: Props) {
  const { message } = App.useApp();
  const [items, setItems] = useState<Advertisement[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Advertisement | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      setItems(await adsApi.list());
    } catch (err) {
      message.error(extractErrorMessage(err, '加载广告失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void reload();
  }, [open]);

  const openCreate = () => {
    setEditing(null);
    setCreating(true);
  };

  const openEdit = (row: Advertisement) => {
    setEditing(row);
    setCreating(true);
  };

  return (
    <Drawer
      title="广告文案库"
      open={open}
      onClose={onClose}
      width={600}
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建广告
        </Button>
      }
    >
      {loading && items.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40 }}>加载中...</div>
      ) : items.length === 0 ? (
        <Empty description="还没有广告文案" />
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {items.map((row) => (
            <div
              key={row.id}
              style={{
                border: '1px solid #e8e8e8',
                borderRadius: 8,
                padding: 16,
                background: '#fff',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}
            >
              {/* 头部: 编号 + 名称 + 标签 · 右侧操作 */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: 12,
                  marginBottom: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {/* 编号徽章 */}
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: 34,
                      height: 24,
                      padding: '0 8px',
                      background: '#f0faf4',
                      color: '#25d366',
                      border: '1px solid #b7eb8f',
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: 'Menlo, Consolas, monospace',
                    }}
                  >
                    #{row.id}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>{row.name}</span>
                  {row.status === 1 ? (
                    <Tag color="green" style={{ margin: 0 }}>
                      启用
                    </Tag>
                  ) : (
                    <Tag style={{ margin: 0 }}>已禁用</Tag>
                  )}
                  {row.assetId !== null && (
                    <Tag color="blue" icon={<PictureOutlined />} style={{ margin: 0 }}>
                      含素材
                    </Tag>
                  )}
                  {row.aiEnabled && (row.variants?.length ?? 0) === 0 && (
                    <Tooltip title="AI 变体池开了但还没生成 · 当前发送仍会用原文. 点编辑进去生成">
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
                    onClick={() => openEdit(row)}
                    style={{ padding: '0 8px' }}
                  >
                    编辑
                  </Button>
                  <Popconfirm
                    title="删除这条广告?"
                    onConfirm={async () => {
                      try {
                        await adsApi.remove(row.id);
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

              {/* 正文预览 */}
              <div
                style={{
                  whiteSpace: 'pre-wrap',
                  color: '#555',
                  fontSize: 13,
                  lineHeight: 1.65,
                  maxHeight: 100,
                  overflow: 'hidden',
                  borderTop: '1px dashed #f0f0f0',
                  paddingTop: 10,
                }}
              >
                {row.content}
              </div>
            </div>
          ))}
        </Space>
      )}

      {creating && (
        <AdEditorModal
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

function AdEditorModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: Advertisement | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message, modal } = App.useApp();

  const [name, setName] = useState(editing?.name ?? '');
  const [content, setContent] = useState(editing?.content ?? '');
  const [assetId, setAssetId] = useState<number | null>(editing?.assetId ?? null);
  const [assetMeta, setAssetMeta] = useState<AssetPreviewMeta | null>(null);
  const [aiEnabled, setAiEnabled] = useState(editing?.aiEnabled ?? false);
  const [variants, setVariants] = useState<AdVariant[]>(editing?.variants ?? []);

  // 2026-04-24 · 跟踪 "当前记录的 id" · 新建模式里开 AI 会触发自动保存 · 之后 id 可用
  const [recordId, setRecordId] = useState<number | null>(editing?.id ?? null);

  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);

  const isEdit = recordId !== null;

  // 打开时 · 若已有 assetId · 拉 asset 元数据显示缩略图
  useEffect(() => {
    if (assetId === null) {
      setAssetMeta(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.get<{
          id: number;
          kind: string;
          filePath?: string;
          meta?: Record<string, unknown> | null;
        }>(`/assets/meta/${assetId}`);
        if (!cancelled) {
          setAssetMeta({
            id: res.data.id,
            kind: res.data.kind as AssetKind,
            filename:
              (res.data.meta as Record<string, unknown> | null | undefined)?.originalFilename as string | undefined,
          });
        }
      } catch {
        if (!cancelled) setAssetMeta({ id: assetId, kind: 'file', filename: undefined });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  // ── 素材上传 · 自动判 kind · 返 asset 含 id/kind/meta ──
  const uploadProps: UploadProps = {
    accept: 'image/*,video/*,audio/*',
    showUploadList: false,
    maxCount: 1,
    beforeUpload: async (file) => {
      setUploading(true);
      try {
        const kind = detectAssetKind(file);
        const form = new FormData();
        form.append('file', file);
        form.append('kind', kind);
        form.append('poolName', 'advertisement');
        const res = await api.post<{ id: number; kind: string; meta?: Record<string, unknown> | null }>(
          '/assets/upload',
          form,
          {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 60_000,
          },
        );
        setAssetId(res.data.id);
        setAssetMeta({
          id: res.data.id,
          kind: res.data.kind as AssetKind,
          filename:
            (res.data.meta as Record<string, unknown> | null | undefined)?.originalFilename as string | undefined,
        });
        message.success('素材已上传');
      } catch (err) {
        message.error(extractErrorMessage(err, '上传失败'));
      } finally {
        setUploading(false);
      }
      return false;
    },
  };

  const runGenerate = async (append: boolean, idOverride?: number) => {
    const id = idOverride ?? recordId;
    if (id === null) return;
    setGenerating(true);
    try {
      // 先保存 content 变化 (针对已保存的记录)
      if (editing && content !== editing.content) {
        await adsApi.update(id, { content });
      }
      const updated = await adsApi.generateVariants(id, 10, append);
      setVariants(updated.variants);
      setAiEnabled(updated.aiEnabled);
      const added = append ? updated.variants.length - variants.length : updated.variants.length;
      message.success(
        append ? `已追加 ${added} 条变体 · 池共 ${updated.variants.length} 条` : `已生成 ${updated.variants.length} 条变体`,
      );
    } catch (err) {
      message.error(extractErrorMessage(err, 'AI 生成失败'));
    } finally {
      setGenerating(false);
    }
  };

  // 2026-04-24 · 确保有 recordId · 新建模式自动 create 一条再返 id
  const ensureRecord = async (): Promise<number | null> => {
    if (recordId !== null) return recordId;
    if (!name.trim()) {
      message.warning('请先填写名称');
      return null;
    }
    if (!content.trim()) {
      message.warning('请先填写文案内容');
      return null;
    }
    try {
      const created = await adsApi.create({
        name,
        content,
        assetId,
        aiEnabled: true,
      });
      setRecordId(created.id);
      message.info(`已自动保存广告 #${created.id} · 准备生成变体...`);
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
      message.warning('变体池已达上限 30 条 · 请先删除部分再追加');
      return;
    }
    await runGenerate(true, id);
  };

  const handleRegenerateAll = async () => {
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

  const handleSave = async () => {
    if (!name.trim()) return message.warning('请输入名称');
    if (!content.trim()) return message.warning('请输入文案');
    setSaving(true);
    try {
      // recordId !== null = 已存在 (新建模式下开了 AI 自动 create 后也算)
      if (recordId !== null) {
        await adsApi.update(recordId, { name, content, assetId, aiEnabled, variants });
        message.success('已保存');
      } else {
        await adsApi.create({ name, content, assetId, aiEnabled });
        message.success('已创建');
      }
      onSaved();
    } catch (err) {
      message.error(extractErrorMessage(err, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  // 切换 AI 开关时的交互 · 2026-04-24 · 新建模式下也能直接生成 (自动先 create)
  const handleToggleAi = (v: boolean) => {
    setAiEnabled(v);
    if (!v) {
      // 关闭 · 不动变体 (留着以便再开启)
      return;
    }
    // 开启 · 若池子空 · 问是否立刻生成
    const variantsEmpty = variants.filter((vv) => vv.content.trim()).length === 0;
    if (!variantsEmpty) return;

    // 需要名称 + 内容才能跑 (新建模式自动保存也需要这两个)
    if (!name.trim() || !content.trim()) {
      message.info('AI 已开启 · 填完名称 + 文案后点"生成 10 条变体"按钮');
      return;
    }

    modal.confirm({
      title: '现在生成 10 条 AI 变体?',
      content: isEdit
        ? '将用 AI 为当前文案生成 10 条不同表达的变体 · 发送时随机抽 1 条 · 约 5-15 秒'
        : '会先自动保存这条广告 · 然后用 AI 生成 10 条变体 · 约 5-15 秒',
      okText: '开始生成',
      cancelText: '先不生成',
      okButtonProps: { style: { background: '#25d366', borderColor: '#25d366' } },
      onOk: () => handleGenerate(),
    });
  };

  const updateVariant = (idx: number, patch: Partial<AdVariant>) => {
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
      title={editing ? `编辑广告 · ${editing.name}` : recordId !== null ? `编辑广告 #${recordId}` : '新建广告'}
      onCancel={onClose}
      width={680}
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
            placeholder="例如: 618 促销广告"
            maxLength={50}
            showCount
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Form.Item>

        <Form.Item
          label="文案内容"
          required
          extra={
            <span style={{ color: '#8c8c8c', fontSize: 12 }}>
              原始文案 · 发送时会根据下方"AI 变体池"设置决定实际发哪条
            </span>
          }
        >
          <Input.TextArea
            rows={4}
            maxLength={4096}
            showCount
            placeholder="写你要发给客户的广告内容..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </Form.Item>

        {/* 附加素材 */}
        <Form.Item label="附加素材 (可选)">
          {assetId !== null ? (
            <AssetPreview
              meta={assetMeta}
              assetId={assetId}
              onRemove={() => {
                setAssetId(null);
                setAssetMeta(null);
              }}
            />
          ) : (
            <Space wrap>
              <Upload {...uploadProps}>
                <Button icon={<UploadOutlined />} loading={uploading}>
                  上传图片 / 视频 / 语音
                </Button>
              </Upload>
              <Tooltip title="手动输入已有素材 ID">
                <InputNumber
                  placeholder="或素材ID"
                  min={1}
                  onChange={(v) => setAssetId(v ?? null)}
                  style={{ width: 130 }}
                />
              </Tooltip>
            </Space>
          )}
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
                <Tooltip title="开启后系统会生成多条不同表达的文案. 发送时随机抽 1 条, 大幅降低封号风险.">
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
                    点上方按钮会自动保存广告并生成变体 (需先填名称和文案)
                  </Typography.Text>
                )}

                {generating ? (
                  <div style={{ textAlign: 'center', padding: 20 }}>
                    <Spin tip="AI 正在生成 10 条变体 · 约 5-15 秒" />
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
                  <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                    {variants.map((v, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'flex',
                          gap: 8,
                          padding: '8px 0',
                          borderBottom: i < variants.length - 1 ? '1px solid #f0f0f0' : 'none',
                          alignItems: 'flex-start',
                        }}
                      >
                        <Tag
                          color={v.enabled ? 'green' : 'default'}
                          style={{ fontWeight: 600, cursor: 'pointer', minWidth: 48, textAlign: 'center' }}
                          onClick={() => updateVariant(i, { enabled: !v.enabled })}
                        >
                          {recordId !== null ? `${recordId}.${v.index}` : `#${v.index}`}
                        </Tag>
                        <Input.TextArea
                          autoSize={{ minRows: 1, maxRows: 4 }}
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
