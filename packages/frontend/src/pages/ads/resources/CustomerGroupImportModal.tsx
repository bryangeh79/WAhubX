import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Input,
  Modal,
  Select,
  Space,
  Statistic,
  Tabs,
  Tag,
  Typography,
  Upload,
} from 'antd';
import type { UploadProps } from 'antd';
import { FolderOpenOutlined, InboxOutlined, PlusCircleOutlined } from '@ant-design/icons';
import {
  customerGroupsApi,
  type CustomerGroup,
  type ImportResult,
} from '@/lib/campaigns-api';
import { extractErrorMessage } from '@/lib/api';
import {
  parseCsvText,
  parsePastedText,
  parseXlsxBuffer,
  summarize,
  type ParsedRow,
  type PreviewStat,
} from './phoneParseUtil';
import { BRAND, BRAND_SOFT } from '../wizard/shared';

type Step = 'config' | 'preview' | 'result';

interface Props {
  open: boolean;
  groupId: number | null; // 若传, 预设为导入到该组 · 否则新建
  onClose: () => void;
  onImported: () => void;
}

export function CustomerGroupImportModal({ open, groupId, onClose, onImported }: Props) {
  const { message } = App.useApp();

  const [step, setStep] = useState<Step>('config');

  // 目标组
  const [destMode, setDestMode] = useState<'new' | 'existing'>(groupId ? 'existing' : 'new');
  const [existingGroupId, setExistingGroupId] = useState<number | null>(groupId);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');
  const [allGroups, setAllGroups] = useState<CustomerGroup[]>([]);

  // 来源
  const [sourceTab, setSourceTab] = useState<'paste' | 'file'>('paste');
  const [paste, setPaste] = useState('');
  const [fileRows, setFileRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');

  // 预览 / 结果
  const [preview, setPreview] = useState<PreviewStat | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [destGroupName, setDestGroupName] = useState<string>('');

  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setStep('config');
    setDestMode(groupId ? 'existing' : 'new');
    setExistingGroupId(groupId);
    setNewGroupName('');
    setNewGroupDesc('');
    setSourceTab('paste');
    setPaste('');
    setFileRows([]);
    setFileName('');
    setPreview(null);
    setImportResult(null);
    setDestGroupName('');
  };

  useEffect(() => {
    if (open) {
      reset();
      void customerGroupsApi.list().then(setAllGroups).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, groupId]);

  // ── 文件拖拽上传 · 客户端解析 ────────────────────────
  const fileUpload: UploadProps = {
    accept: '.csv,.txt,.tsv,.xlsx,.xls',
    maxCount: 1,
    showUploadList: false,
    beforeUpload: async (file) => {
      try {
        const name = file.name.toLowerCase();
        let rows: ParsedRow[] = [];
        if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
          const buf = await file.arrayBuffer();
          rows = parseXlsxBuffer(buf);
        } else {
          const text = await file.text();
          rows = parseCsvText(text);
        }
        if (rows.length === 0) {
          message.warning('文件解析出 0 条数据 · 请检查');
          return false;
        }
        setFileRows(rows);
        setFileName(file.name);
        message.success(`已读入 ${file.name} · ${rows.length} 行`);
      } catch (err) {
        message.error(`文件解析失败: ${err instanceof Error ? err.message : String(err)}`);
      }
      return false;
    },
  };

  // ── 目标组校验 ─────────────────────────────────────
  const validateDest = (): { ok: boolean; err?: string } => {
    if (destMode === 'new') {
      if (!newGroupName.trim()) return { ok: false, err: '请输入新组名称' };
      return { ok: true };
    }
    if (!existingGroupId) return { ok: false, err: '请选择已有组' };
    return { ok: true };
  };

  // ── 解析当前来源 → 预览步骤 ─────────────────────────
  const goPreview = () => {
    const d = validateDest();
    if (!d.ok) {
      message.warning(d.err);
      return;
    }
    let rows: ParsedRow[] = [];
    if (sourceTab === 'paste') {
      rows = parsePastedText(paste);
    } else {
      rows = fileRows;
    }
    if (rows.length === 0) {
      message.warning(
        sourceTab === 'paste' ? '请粘贴号码后再继续' : '请先上传文件',
      );
      return;
    }
    setPreview(summarize(rows));
    setStep('preview');
  };

  // ── 只建空组 (不导入号码) ──────────────────────────
  const createEmptyGroup = async () => {
    const d = validateDest();
    if (!d.ok) {
      message.warning(d.err);
      return;
    }
    if (destMode !== 'new') {
      message.warning('只有"创建新组"模式支持仅建空组');
      return;
    }
    setSubmitting(true);
    try {
      await customerGroupsApi.create({
        name: newGroupName.trim(),
        description: newGroupDesc.trim() || undefined,
      });
      message.success('空组已创建');
      onImported();
      onClose();
    } catch (err) {
      message.error(extractErrorMessage(err, '创建失败'));
    } finally {
      setSubmitting(false);
    }
  };

  // ── 确认导入 ────────────────────────────────────────
  const handleConfirm = async () => {
    if (!preview || preview.validUnique.length === 0) {
      message.warning('没有有效号码可以导入');
      return;
    }
    setSubmitting(true);
    try {
      let targetGroupId = existingGroupId;
      let targetName = '';

      if (destMode === 'new') {
        const created = await customerGroupsApi.create({
          name: newGroupName.trim(),
          description: newGroupDesc.trim() || undefined,
        });
        targetGroupId = created.id;
        targetName = created.name;
      } else {
        targetName = allGroups.find((g) => g.id === existingGroupId)?.name ?? `#${existingGroupId}`;
      }
      if (targetGroupId === null) {
        message.error('目标组未确定');
        return;
      }

      const rawBlob = preview.validUnique.join('\n');
      const res = await customerGroupsApi.importPaste(targetGroupId, rawBlob);
      setImportResult(res);
      setDestGroupName(targetName);
      setStep('result');
      onImported();
    } catch (err) {
      message.error(extractErrorMessage(err, '导入失败'));
    } finally {
      setSubmitting(false);
    }
  };

  // ──────────────────────────────────────────────────
  // 渲染 · 配置页 (目标组 + 来源一页搞定)
  // ──────────────────────────────────────────────────
  const renderConfigStep = () => (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      {/* 目标组 · 两张大卡 */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#333' }}>
          1. 选择目标客户群
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <DestCard
            active={destMode === 'new'}
            onClick={() => setDestMode('new')}
            icon={<PlusCircleOutlined />}
            title="创建新组"
            desc="新建一个客户群 · 把这批号放进去"
          />
          <DestCard
            active={destMode === 'existing'}
            onClick={() => setDestMode('existing')}
            icon={<FolderOpenOutlined />}
            title="导入到已有组"
            desc="加到已存在的客户群 · 自动去重"
            disabled={allGroups.length === 0}
            disabledHint="还没有已有组"
          />
        </div>

        {destMode === 'new' ? (
          <div
            style={{
              marginTop: 12,
              padding: 14,
              border: '1px solid #e8e8e8',
              borderRadius: 8,
              background: '#fafafa',
            }}
          >
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <Input
                placeholder="新组名称 · 例如: 618 促销客户"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                maxLength={128}
                showCount
              />
              <Input.TextArea
                placeholder="描述 (可选) · 例如: 2026-04 电信广告目标"
                value={newGroupDesc}
                onChange={(e) => setNewGroupDesc(e.target.value)}
                maxLength={512}
                rows={2}
              />
            </Space>
          </div>
        ) : (
          <div style={{ marginTop: 12 }}>
            <Select
              style={{ width: '100%' }}
              placeholder={allGroups.length === 0 ? '还没有已有组 · 请选 "创建新组"' : '选择已有客户群'}
              value={existingGroupId ?? undefined}
              onChange={(v) => setExistingGroupId(v)}
              disabled={allGroups.length === 0}
              options={allGroups.map((g) => ({
                value: g.id,
                label: `${g.name} · ${g.memberCount} 人`,
              }))}
            />
          </div>
        )}
      </div>

      {/* 来源 */}
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#333' }}>
          2. 添加号码 · 选一种方式
        </div>
        <Tabs
          activeKey={sourceTab}
          onChange={(k) => setSourceTab(k as 'paste' | 'file')}
          items={[
            {
              key: 'paste',
              label: '粘贴号码',
              children: (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    一行一个号码 · 或逗号 / 空格分隔均可. 系统自动规范化 + 去重.
                  </Typography.Text>
                  <Input.TextArea
                    rows={8}
                    value={paste}
                    onChange={(e) => setPaste(e.target.value)}
                    placeholder={'60186888168\n60168160836\n+60123456789'}
                  />
                </Space>
              ),
            },
            {
              key: 'file',
              label: 'Excel / CSV 文件',
              children: (
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 4 }}
                    message="支持 .xlsx / .csv / .txt / .tsv · 第 1 列是号码, 可含表头 phone/name/tag"
                  />
                  <Upload.Dragger {...fileUpload}>
                    <p className="ant-upload-drag-icon">
                      <InboxOutlined />
                    </p>
                    <p>{fileName ? `已选: ${fileName}` : '点击或拖拽文件到此处'}</p>
                    <p style={{ fontSize: 12, color: '#8c8c8c' }}>
                      {fileName ? `已读入 ${fileRows.length} 行 · 重传换文件` : '.xlsx / .csv 都支持'}
                    </p>
                  </Upload.Dragger>
                </Space>
              ),
            },
          ]}
        />
      </div>

      {/* 底部按钮 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          paddingTop: 4,
        }}
      >
        <Space>
          <Button onClick={onClose} disabled={submitting}>
            取消
          </Button>
          {destMode === 'new' && (
            <Button onClick={createEmptyGroup} loading={submitting}>
              仅创建空组 (不导入号码)
            </Button>
          )}
        </Space>
        <Button
          type="primary"
          onClick={goPreview}
          style={{ background: BRAND, borderColor: BRAND }}
        >
          下一步 · 预览 →
        </Button>
      </div>
    </Space>
  );

  // ── 预览步骤 ─────────────────────────────────
  const renderPreviewStep = () => {
    if (!preview) return null;
    const showInvalid = preview.invalidRows.slice(0, 20);
    const hasDupOrErr = preview.duplicateCount > 0 || preview.invalidRows.length > 0;
    const destLabel =
      destMode === 'new'
        ? `新组 · ${newGroupName}`
        : `已有组 · ${allGroups.find((g) => g.id === existingGroupId)?.name ?? ''}`;
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message={`将导入到: ${destLabel}`}
          style={{ fontSize: 13 }}
        />

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 12,
            padding: 16,
            border: '1px solid #e8e8e8',
            borderRadius: 8,
            background: '#fafafa',
          }}
        >
          <Statistic title="总号码" value={preview.total} />
          <Statistic
            title="有效号码"
            value={preview.validUnique.length}
            valueStyle={{ color: BRAND }}
          />
          <Statistic
            title="本批重复"
            value={preview.duplicateCount}
            valueStyle={{ color: preview.duplicateCount > 0 ? '#fa8c16' : '#999' }}
          />
          <Statistic
            title="格式错误"
            value={preview.invalidRows.length}
            valueStyle={{ color: preview.invalidRows.length > 0 ? '#f5222d' : '#999' }}
          />
        </div>

        {hasDupOrErr && (
          <Alert
            type="warning"
            showIcon
            message="系统会自动跳过重复和格式错误 · 只导入有效号码"
            description={
              preview.invalidRows.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <Typography.Text style={{ fontSize: 12 }}>错误样例:</Typography.Text>
                  <div style={{ marginTop: 4, maxHeight: 100, overflowY: 'auto' }}>
                    {showInvalid.map((r, i) => (
                      <Tag key={i} color="red" style={{ margin: '2px 4px 2px 0', fontSize: 11 }}>
                        {r.raw || '(空)'}
                      </Tag>
                    ))}
                    {preview.invalidRows.length > 20 && (
                      <Tag color="default" style={{ fontSize: 11 }}>
                        +{preview.invalidRows.length - 20} 条
                      </Tag>
                    )}
                  </div>
                </div>
              )
            }
          />
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            paddingTop: 8,
            borderTop: '1px solid #f0f0f0',
          }}
        >
          <Button onClick={() => setStep('config')}>← 上一步</Button>
          <Button
            type="primary"
            loading={submitting}
            onClick={handleConfirm}
            disabled={preview.validUnique.length === 0}
            style={{ background: BRAND, borderColor: BRAND }}
          >
            确认导入 {preview.validUnique.length} 个号码
          </Button>
        </div>
      </Space>
    );
  };

  // ── 结果步骤 ─────────────────────────────────
  const renderResultStep = () => {
    if (!importResult) return null;
    const ok = importResult.added > 0;
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        {/* 顶部状态横幅 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '18px 20px',
            border: `1px solid ${ok ? '#b7eb8f' : '#ffd591'}`,
            background: ok ? '#f6ffed' : '#fffbe6',
            borderRadius: 10,
          }}
        >
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              background: ok ? BRAND : '#faad14',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              flexShrink: 0,
            }}
          >
            {ok ? '✓' : '!'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#333' }}>
              {ok ? '导入成功' : '未有新增号码'}
            </div>
            <div style={{ fontSize: 13, color: '#666', marginTop: 2 }}>
              目标客户群 ·{' '}
              <Typography.Text strong style={{ color: '#333' }}>
                {destGroupName}
              </Typography.Text>
            </div>
          </div>
        </div>

        {/* 统计 4 格 */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 12,
            padding: 16,
            border: '1px solid #eaeaea',
            borderRadius: 10,
            background: '#fafafa',
          }}
        >
          <StatBox label="新增号码" value={importResult.added} color={BRAND} />
          <StatBox
            label="组内重复"
            hint="已在组中 · 跳过"
            value={importResult.skippedDuplicate}
            color={importResult.skippedDuplicate > 0 ? '#fa8c16' : '#bbb'}
          />
          <StatBox
            label="格式错误"
            hint="号码不合规"
            value={importResult.skippedInvalid}
            color={importResult.skippedInvalid > 0 ? '#f5222d' : '#bbb'}
          />
          <StatBox
            label="本批总数"
            hint="包括重复/错误"
            value={importResult.total}
            color="#555"
          />
        </div>

        {/* 预览侧补充信息 */}
        <div
          style={{
            fontSize: 12,
            color: '#8c8c8c',
            padding: '8px 12px',
            background: '#f7f7f7',
            borderRadius: 6,
            borderLeft: `3px solid ${BRAND}`,
          }}
        >
          本批预览: 原始 {preview?.total ?? 0} 条 · 规范化去重后 {preview?.validUnique.length ?? 0} 条 ·
          本批内重复 {preview?.duplicateCount ?? 0} 条 · 格式错误 {preview?.invalidRows.length ?? 0} 条
        </div>

        {/* 底部按钮 */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            paddingTop: 4,
          }}
        >
          <Button onClick={reset}>继续导入</Button>
          <Button
            type="primary"
            onClick={onClose}
            style={{ background: BRAND, borderColor: BRAND }}
          >
            完成
          </Button>
        </div>
      </Space>
    );
  };

  return (
    <Modal
      title={
        step === 'config'
          ? groupId
            ? '导入号码到当前组'
            : '新建客户群 / 导入号码'
          : step === 'preview'
            ? '预览 · 确认导入'
            : '导入完成'
      }
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={720}
    >
      {step === 'config' && renderConfigStep()}
      {step === 'preview' && renderPreviewStep()}
      {step === 'result' && renderResultStep()}
    </Modal>
  );
}

// ─── 结果统计小格 ──────────────────────────────
function StatBox({
  label,
  value,
  color,
  hint,
}: {
  label: string;
  value: number;
  color: string;
  hint?: string;
}) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 12, color: '#8c8c8c' }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600, color, lineHeight: 1.2, marginTop: 4 }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

// ─── 目标组大卡 ──────────────────────────────────

function DestCard({
  active,
  onClick,
  icon,
  title,
  desc,
  disabled,
  disabledHint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  desc: string;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        border: active ? `2px solid ${BRAND}` : '1px solid #e0e0e0',
        background: disabled ? '#f5f5f5' : active ? BRAND_SOFT : '#fff',
        borderRadius: 8,
        padding: active ? '15px 16px' : '16px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'all 0.15s',
        textAlign: 'center',
      }}
      onMouseEnter={(e) => {
        if (!active && !disabled) (e.currentTarget.style.borderColor = '#8ee2ad');
      }}
      onMouseLeave={(e) => {
        if (!active && !disabled) (e.currentTarget.style.borderColor = '#e0e0e0');
      }}
    >
      <div style={{ fontSize: 22, color: active ? BRAND : disabled ? '#d9d9d9' : '#8c8c8c', marginBottom: 6 }}>
        {icon}
      </div>
      <div style={{ fontWeight: 600, fontSize: 14, color: active ? BRAND : '#333', marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ fontSize: 12, color: '#8c8c8c' }}>
        {disabled && disabledHint ? disabledHint : desc}
      </div>
    </div>
  );
}
