// M10 · 备份 Tab
//   - 顶部 E2 recovery red banner (locked 时显示)
//   - Section 1: Daily 快照 · 状态 + 手动触发 + 日期列表
//   - Section 2: Manual export/import · 按钮 + 文件列表
//   - Section 3: Per-slot restore · 选槽 → 选日期 → 恢复

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Empty,
  Input,
  List,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  Upload,
  message as antdMessage,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { UploadFile } from 'antd';
import { api, extractErrorMessage } from '@/lib/api';

const { Text, Paragraph } = Typography;

interface DailyStatus {
  lastDailyAt: string | null;
  retentionDays: number;
  dailyHour: number;
  dates: Array<{ date: string; slotCount: number; totalBytes: number }>;
}

interface ManualFile {
  filename: string;
  sizeBytes: number;
  createdAt: string;
}

interface RecoveryStatusView {
  state: 'normal' | 'locked';
  reason?: string;
  providersCount?: number;
  machineFingerprint?: string;
}

interface SlotSummary {
  id: number;
  slotIndex: number;
  accountId: number | null;
  wa?: { phoneNumber: string | null } | null;
}

export function BackupTab() {
  const [recovery, setRecovery] = useState<RecoveryStatusView>({ state: 'normal' });
  const [daily, setDaily] = useState<DailyStatus | null>(null);
  const [manual, setManual] = useState<ManualFile[]>([]);
  const [slots, setSlots] = useState<SlotSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningDaily, setRunningDaily] = useState(false);
  const [exporting, setExporting] = useState(false);

  // ── Recovery Modal ──
  const [recModalOpen, setRecModalOpen] = useState(false);
  const [recMode, setRecMode] = useState<'env' | 'wab'>('env');
  const [envKeyHex, setEnvKeyHex] = useState('');
  const [recUploadFile, setRecUploadFile] = useState<UploadFile | null>(null);
  const [recOverrideKey, setRecOverrideKey] = useState('');
  const [recSubmitting, setRecSubmitting] = useState(false);

  // ── Import Modal ──
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState<UploadFile | null>(null);
  const [importPreview, setImportPreview] = useState<{
    manifest: { app_version: string; created_at: string; source: string; slot_count: number };
    schemaMatches: boolean;
    currentSchemaHash: string;
  } | null>(null);
  const [importSubmitting, setImportSubmitting] = useState(false);

  // ── Per-slot restore Modal ──
  const [slotRestoreModal, setSlotRestoreModal] = useState<{ slot: SlotSummary; snapshots: Array<{ date: string; sizeBytes: number }> } | null>(null);
  const [restoreDate, setRestoreDate] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, d, m, s] = await Promise.all([
        api.get<RecoveryStatusView>('/backup/recovery/status'),
        api.get<DailyStatus>('/backup/daily'),
        api.get<{ files: ManualFile[] }>('/backup/manual'),
        api.get<SlotSummary[]>('/slots'),
      ]);
      setRecovery(r.data);
      setDaily(d.data);
      setManual(m.data.files);
      setSlots(s.data);
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ── Daily 手动触发 ──
  const handleRunDaily = async () => {
    setRunningDaily(true);
    try {
      const res = await api.post<{ date: string; slots: Array<{ ok: boolean }> }>('/backup/daily/run-now');
      const okCount = res.data.slots.filter((x) => x.ok).length;
      antdMessage.success(`daily ${res.data.date} 完成 · ${okCount}/${res.data.slots.length} 槽`);
      void load();
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, 'daily 失败'));
    } finally {
      setRunningDaily(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.post<{ filename: string; sizeBytes: number }>('/backup/export', {});
      antdMessage.success(`导出 · ${res.data.filename} · ${(res.data.sizeBytes / 1024).toFixed(0)} KB`);
      void load();
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '导出失败'));
    } finally {
      setExporting(false);
    }
  };

  // ── Import preview & commit ──
  const handleImportPreview = async () => {
    if (!importFile?.originFileObj) return;
    const fd = new FormData();
    fd.append('file', importFile.originFileObj);
    try {
      const res = await api.post<typeof importPreview>('/backup/import/preview', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportPreview(res.data);
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, 'preview 失败 · 文件可能不是 .wab 或已损坏'));
    }
  };

  const handleImportCommit = async () => {
    if (!importFile?.originFileObj) return;
    setImportSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('file', importFile.originFileObj);
      await api.post('/backup/import', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300_000,
      });
      antdMessage.success('导入完成 · 数据已恢复 · 建议刷新页面');
      setImportModalOpen(false);
      setImportFile(null);
      setImportPreview(null);
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '导入失败 · 已自动回滚到 pre-import 备份'));
    } finally {
      setImportSubmitting(false);
    }
  };

  // ── Per-slot restore ──
  const openSlotRestore = async (slot: SlotSummary) => {
    try {
      const res = await api.get<{ snapshots: Array<{ date: string; sizeBytes: number }> }>(
        `/backup/slots/${slot.id}/snapshots`,
      );
      setSlotRestoreModal({ slot, snapshots: res.data.snapshots });
      setRestoreDate(res.data.snapshots[0]?.date ?? null);
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '加载快照失败'));
    }
  };

  const handlePerSlotRestore = async () => {
    if (!slotRestoreModal || !restoreDate) return;
    setRestoring(true);
    try {
      await api.post(`/backup/slots/${slotRestoreModal.slot.id}/restore`, { date: restoreDate });
      antdMessage.success(`slot ${slotRestoreModal.slot.slotIndex} 从 ${restoreDate} 恢复成功`);
      setSlotRestoreModal(null);
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, '恢复失败'));
    } finally {
      setRestoring(false);
    }
  };

  // ── Recovery (E2) ──
  const handleRecoveryEnv = async () => {
    setRecSubmitting(true);
    try {
      const res = await api.post<{ migratedCount: number }>('/backup/recovery/env-key', { envKeyHex });
      antdMessage.success(`recovery 成功 · 迁移 ${res.data.migratedCount} provider`);
      setRecModalOpen(false);
      setEnvKeyHex('');
      void load();
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, 'recovery 失败 · 请核对 env key'));
    } finally {
      setRecSubmitting(false);
    }
  };

  const handleRecoveryWab = async () => {
    if (!recUploadFile?.originFileObj) return;
    setRecSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('file', recUploadFile.originFileObj);
      if (recOverrideKey) fd.append('overrideKeyHex', recOverrideKey);
      await api.post('/backup/recovery/import', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 300_000,
      });
      antdMessage.success('recovery 成功 · 请刷新页面');
      setRecModalOpen(false);
      setRecUploadFile(null);
      setRecOverrideKey('');
      void load();
    } catch (err) {
      antdMessage.error(extractErrorMessage(err, 'recovery 导入失败'));
    } finally {
      setRecSubmitting(false);
    }
  };

  // ── 渲染 ──
  const dailyColumns: ColumnsType<{ date: string; slotCount: number; totalBytes: number }> = useMemo(
    () => [
      { title: '日期', dataIndex: 'date', width: 120 },
      { title: '槽数', dataIndex: 'slotCount', width: 80 },
      {
        title: '大小',
        dataIndex: 'totalBytes',
        render: (v: number) => `${(v / 1024).toFixed(0)} KB`,
      },
    ],
    [],
  );

  const manualColumns: ColumnsType<ManualFile> = useMemo(
    () => [
      {
        title: '文件',
        dataIndex: 'filename',
        render: (f: string) => <code style={{ fontSize: 11 }}>{f}</code>,
      },
      {
        title: '大小',
        dataIndex: 'sizeBytes',
        width: 100,
        render: (v: number) => `${(v / 1024).toFixed(0)} KB`,
      },
      {
        title: '创建时间',
        dataIndex: 'createdAt',
        render: (v: string) => new Date(v).toLocaleString('zh-CN'),
      },
      {
        title: '下载',
        render: (_: unknown, row) => (
          <Button
            size="small"
            onClick={() => window.open(`/api/v1/backup/manual/${encodeURIComponent(row.filename)}/download`, '_blank')}
          >
            下载
          </Button>
        ),
      },
    ],
    [],
  );

  return (
    <Card size="small" extra={<Button size="small" onClick={() => void load()} loading={loading}>刷新</Button>}>
      {recovery.state === 'locked' && (
        <Alert
          type="error"
          showIcon
          banner
          style={{ marginBottom: 12 }}
          message={`⚠️ 检测到硬件指纹变化 · AI 功能已锁定`}
          description={
            <div>
              <div>{recovery.reason}</div>
              <div style={{ marginTop: 4, fontSize: 12 }}>
                当前 machine: <code>{recovery.machineFingerprint}</code>
              </div>
              <Button danger type="primary" size="small" style={{ marginTop: 8 }} onClick={() => setRecModalOpen(true)}>
                恢复加密密钥 →
              </Button>
            </div>
          }
        />
      )}

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="M10 备份 · §B.11 三层策略"
        description={
          <>
            <b>Layer 1</b> 每日 {daily?.dailyHour ?? 3}:00 自动 · 保 {daily?.retentionDays ?? 7} 天 ·{' '}
            <b>Layer 2</b> 手动 .wab 导出/导入 (F+ 自动回滚) · <b>Layer 3</b> 云备份 V2 · 所有 .wab 走 AES-256-GCM · MasterKey 机器绑定
          </>
        }
      />

      <Row gutter={12}>
        <Col span={12}>
          <Card size="small" title="每日本地快照" extra={<Button size="small" loading={runningDaily} onClick={() => void handleRunDaily()}>立即运行</Button>}>
            <Row gutter={8} style={{ marginBottom: 8 }}>
              <Col span={12}>
                <Statistic title="最近一次" value={daily?.lastDailyAt ? new Date(daily.lastDailyAt).toLocaleString('zh-CN') : '—'} valueStyle={{ fontSize: 13 }} />
              </Col>
              <Col span={12}>
                <Statistic title="快照天数" value={daily?.dates.length ?? 0} suffix={`/ ${daily?.retentionDays ?? 7}`} />
              </Col>
            </Row>
            <Table
              rowKey="date"
              size="small"
              columns={dailyColumns}
              dataSource={daily?.dates ?? []}
              pagination={false}
              locale={{ emptyText: <Empty description="尚无快照" /> }}
            />
          </Card>
        </Col>

        <Col span={12}>
          <Card
            size="small"
            title=".wab 手动备份"
            extra={
              <Space>
                <Button size="small" type="primary" loading={exporting} onClick={() => void handleExport()}>
                  导出
                </Button>
                <Button size="small" onClick={() => setImportModalOpen(true)}>
                  导入
                </Button>
              </Space>
            }
          >
            <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
              F+ 导入前自动备份到 pre-import/ · 失败自动回滚
            </Paragraph>
            <Table
              rowKey="filename"
              size="small"
              columns={manualColumns}
              dataSource={manual}
              pagination={{ pageSize: 5 }}
              locale={{ emptyText: <Empty description="尚无手动备份" /> }}
            />
          </Card>
        </Col>
      </Row>

      <Divider style={{ margin: '12px 0' }} />

      <Card size="small" title="单槽 daily 快照恢复 (§B.18 · 补强 1)">
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          从 daily 快照选日期恢复**单个** slot 的 wa-session + fingerprint · 不动 DB · baileys 自动重连
        </Paragraph>
        <List
          size="small"
          bordered
          dataSource={slots.filter((s) => s.accountId !== null)}
          locale={{ emptyText: <Empty description="无已绑定账号" /> }}
          renderItem={(s) => (
            <List.Item
              actions={[
                <Button size="small" key="restore" onClick={() => void openSlotRestore(s)}>
                  从快照恢复
                </Button>,
              ]}
            >
              <Space>
                <Tag color="blue">#{String(s.slotIndex).padStart(2, '0')}</Tag>
                <Text>{s.wa?.phoneNumber ?? '—'}</Text>
              </Space>
            </List.Item>
          )}
        />
      </Card>

      {/* ── Modals ── */}
      <Modal
        title=".wab 导入 · defense in depth"
        open={importModalOpen}
        onCancel={() => {
          setImportModalOpen(false);
          setImportFile(null);
          setImportPreview(null);
        }}
        footer={null}
        destroyOnClose
      >
        <Alert
          type="warning"
          showIcon
          message="⚠️ 导入会覆盖当前数据库所有数据"
          description="F+ 自动先把当前状态备份到 pre-import/ · 失败自动回滚 · 但强烈建议先手动导出一份 .wab 双保险"
          style={{ marginBottom: 12 }}
        />
        <Upload
          beforeUpload={() => false}
          maxCount={1}
          fileList={importFile ? [importFile] : []}
          onChange={({ fileList }) => {
            setImportFile(fileList[0] ?? null);
            setImportPreview(null);
          }}
        >
          <Button>选择 .wab 文件</Button>
        </Upload>
        {importFile && !importPreview && (
          <Button style={{ marginTop: 8 }} onClick={() => void handleImportPreview()}>
            预览 manifest
          </Button>
        )}
        {importPreview && (
          <div style={{ marginTop: 12, fontSize: 12 }}>
            <p>应用版本: <code>{importPreview.manifest.app_version}</code></p>
            <p>创建时间: {new Date(importPreview.manifest.created_at).toLocaleString('zh-CN')}</p>
            <p>来源: <Tag>{importPreview.manifest.source}</Tag></p>
            <p>槽数: {importPreview.manifest.slot_count}</p>
            <p>Schema 匹配: {importPreview.schemaMatches ? <Tag color="success">✓</Tag> : <Tag color="warning">⚠️ 不匹配</Tag>}</p>
            <Popconfirm
              title="确认导入 · 覆盖当前数据?"
              description={importPreview.schemaMatches ? '' : 'Schema 不匹配 · 可能导致数据不完整'}
              okText="确认导入"
              okButtonProps={{ danger: true, loading: importSubmitting }}
              cancelText="取消"
              onConfirm={() => void handleImportCommit()}
            >
              <Button type="primary" danger style={{ marginTop: 8 }}>
                确认导入
              </Button>
            </Popconfirm>
          </div>
        )}
      </Modal>

      <Modal
        title="单槽快照恢复"
        open={!!slotRestoreModal}
        onCancel={() => setSlotRestoreModal(null)}
        onOk={() => void handlePerSlotRestore()}
        okText="恢复"
        okButtonProps={{ danger: true, loading: restoring, disabled: !restoreDate }}
        cancelText="取消"
        destroyOnClose
      >
        {slotRestoreModal && (
          <>
            <Paragraph>
              Slot <Tag color="blue">#{String(slotRestoreModal.slot.slotIndex).padStart(2, '0')}</Tag>{' '}
              {slotRestoreModal.slot.wa?.phoneNumber ?? ''}
            </Paragraph>
            {slotRestoreModal.snapshots.length === 0 ? (
              <Alert type="warning" showIcon message="该 slot 没有可用快照" />
            ) : (
              <>
                <Text>选择快照日期:</Text>
                <Select
                  style={{ width: '100%', marginTop: 8 }}
                  value={restoreDate}
                  onChange={setRestoreDate}
                  options={slotRestoreModal.snapshots.map((s) => ({
                    value: s.date,
                    label: `${s.date} · ${(s.sizeBytes / 1024).toFixed(0)} KB`,
                  }))}
                />
                <Alert
                  type="info"
                  showIcon
                  style={{ marginTop: 12 }}
                  message="恢复后 baileys 自动重连"
                  description="wa-session 被覆盖 · 下一 tick 自动 evict + rehydrate · 若号失效需重新 bind"
                />
              </>
            )}
          </>
        )}
      </Modal>

      <Modal
        title="🔒 硬件指纹变化恢复"
        open={recModalOpen}
        onCancel={() => setRecModalOpen(false)}
        footer={null}
        destroyOnClose
        width={540}
      >
        <Alert
          type="error"
          showIcon
          message="数据被原机器密钥锁定"
          description="两种恢复方案 · 任选其一"
          style={{ marginBottom: 12 }}
        />
        <Space direction="vertical" style={{ width: '100%' }}>
          <Button.Group style={{ width: '100%' }}>
            <Button type={recMode === 'env' ? 'primary' : 'default'} onClick={() => setRecMode('env')} style={{ width: '50%' }}>
              方案 A · 输入原 env key
            </Button>
            <Button type={recMode === 'wab' ? 'primary' : 'default'} onClick={() => setRecMode('wab')} style={{ width: '50%' }}>
              方案 B · 导入历史 .wab
            </Button>
          </Button.Group>
          {recMode === 'env' ? (
            <>
              <Text>原 <code>APP_ENCRYPTION_KEY</code> (64 位 hex · 32B):</Text>
              <Input.Password
                value={envKeyHex}
                onChange={(e) => setEnvKeyHex(e.target.value)}
                placeholder="0123456789abcdef... (64 hex)"
                maxLength={64}
              />
              <Button
                type="primary"
                loading={recSubmitting}
                disabled={!/^[0-9a-fA-F]{64}$/.test(envKeyHex)}
                onClick={() => void handleRecoveryEnv()}
                block
              >
                验证 + 重加密为 machine-bound
              </Button>
            </>
          ) : (
            <>
              <Upload
                beforeUpload={() => false}
                maxCount={1}
                fileList={recUploadFile ? [recUploadFile] : []}
                onChange={({ fileList }) => setRecUploadFile(fileList[0] ?? null)}
              >
                <Button>选择 .wab (优先 pre-migration)</Button>
              </Upload>
              <Text>(可选) 原 env key 作 override:</Text>
              <Input.Password
                value={recOverrideKey}
                onChange={(e) => setRecOverrideKey(e.target.value)}
                placeholder="若 .wab 用原 env key 加密 · 填 · 否则留空"
                maxLength={64}
              />
              <Button
                type="primary"
                loading={recSubmitting}
                disabled={!recUploadFile}
                onClick={() => void handleRecoveryWab()}
                block
              >
                导入 + 重新加密
              </Button>
            </>
          )}
        </Space>
      </Modal>
    </Card>
  );
}
