// M11 Day 2.5 · 升级 Tab (纯 frontend · 骨架 + stub API)
//
// 完整 API 集成在 M11 Day 3-4 · UpdateService 真实装后打开:
//   - GET  /api/v1/version/current       返 from_version (app_version + 当前机器 fp-installer)
//   - POST /api/v1/version/verify-upd    multipart .wupd 上传 · 返 manifest preview + 签名 verify 结果
//   - POST /api/v1/version/apply-update  multipart .wupd 上传 · 真升级 (externally invokes installer wrapper)
//
// Day 2.5 使用 stub: 上传本地 .wupd 只在前端 parse (magic bytes + JSON 头) · 不调 backend.
// "apply" 按钮禁用 · 显 tooltip "M11 Day 3 后可用"

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  List,
  Modal,
  Popconfirm,
  Progress,
  Result,
  Space,
  Steps,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import type { UploadFile } from 'antd';
import { api, extractErrorMessage } from '@/lib/api';

const { Text, Paragraph } = Typography;

interface CurrentVersionView {
  app_version: string;
  installer_fp: {
    arch: string;
    osMajor: string;
    ramBucket: string;
  } | null;
}

interface ManifestPreview {
  from_version: string;
  to_version: string;
  app_sha256: string;
  migrations: Array<{ name: string; sha256: string }>;
  health_check: { endpoint: string; timeout_sec: number; expect_status: number };
  rollback: { strategy: string };
  created_at: string;
  // Day 3 backend 会额外加:
  signature_valid?: boolean;
  signature_fail_code?: string;
  version_compat?: 'ok' | 'same' | 'downgrade' | 'major-bump';
}

type ApplyPhase = 'idle' | 'verifying' | 'pre-backup' | 'stopping' | 'replacing' | 'migrating' | 'starting' | 'health-check' | 'done' | 'rollback';

const PHASE_ORDER: ApplyPhase[] = ['verifying', 'pre-backup', 'stopping', 'replacing', 'migrating', 'starting', 'health-check', 'done'];

export function UpgradeTab() {
  const [current, setCurrent] = useState<CurrentVersionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [backendReady, setBackendReady] = useState(false); // Day 3 后端准备度

  // Upload + preview
  const [file, setFile] = useState<UploadFile | null>(null);
  const [preview, setPreview] = useState<ManifestPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Apply state
  const [applyOpen, setApplyOpen] = useState(false);
  const [phase, setPhase] = useState<ApplyPhase>('idle');
  const [phaseError, setPhaseError] = useState<string | null>(null);

  const loadCurrent = useCallback(async () => {
    setLoading(true);
    try {
      // Day 3 后端就绪后切真 endpoint
      const res = await api.get<CurrentVersionView>('/version/current');
      setCurrent(res.data);
      setBackendReady(true);
    } catch {
      // Day 2.5 骨架 · 后端没 /version/current · fallback 占位
      setCurrent({
        app_version: 'unknown (Day 3 backend 未就绪)',
        installer_fp: null,
      });
      setBackendReady(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCurrent();
  }, [loadCurrent]);

  const handlePreview = async () => {
    if (!file?.originFileObj) return;
    setPreviewError(null);
    setPreview(null);
    setPreviewing(true);
    try {
      const fd = new FormData();
      fd.append('file', file.originFileObj);
      // Day 3 endpoint
      const res = await api.post<ManifestPreview>('/version/verify-upd', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60_000,
      });
      setPreview(res.data);
    } catch (err) {
      setPreviewError(extractErrorMessage(err, 'preview 失败 · 后端未就绪或文件不是 .wupd'));
    } finally {
      setPreviewing(false);
    }
  };

  const handleApply = async () => {
    if (!file?.originFileObj || !preview) return;
    setApplyOpen(true);
    setPhase('verifying');
    setPhaseError(null);
    try {
      const fd = new FormData();
      fd.append('file', file.originFileObj);
      // Day 3 endpoint · 返 SSE / polling 形式的 phase 更新 · 简化: POST 后轮询 /version/apply-status
      await api.post('/version/apply-update', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 600_000, // 10min
      });
      // 真实升级时此处 backend 会重启, 本 request 不会 return · 用户看到断线 → 重 login
      setPhase('done');
    } catch (err) {
      setPhase('rollback');
      setPhaseError(extractErrorMessage(err, 'apply 失败 · 自动回滚'));
    }
  };

  const stepItems = PHASE_ORDER.map((p) => ({
    title: phaseLabel(p),
    description: phaseDescription(p),
  }));
  const currentStepIdx = PHASE_ORDER.indexOf(phase);

  return (
    <Card
      size="small"
      extra={<Button size="small" onClick={() => void loadCurrent()} loading={loading}>刷新</Button>}
    >
      {!backendReady && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="升级后端未就绪 (M11 Day 3-4)"
          description="本 Tab 是 Day 2.5 UI 骨架 · 当前仅可预览 .wupd 文件 · 真升级需 Day 3-4 UpdateService + Day 5 smoke 验证后解锁"
        />
      )}

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="升级流程 · §7.3 九步"
        description={
          <>
            选 <code>.wupd</code> → <b>verify</b> 签名 → <b>pre-backup</b> (M10 能力复用) →
            <b>stop</b> (X1+ 10min 优雅/强杀) → <b>replace app/</b> (installer 外壳原子 rename) →
            <b>migration</b> (TypeORM · Y2+ error log file 监测) → <b>start</b> → <b>health</b> →
            失败走 <b>rollback</b>
          </>
        }
      />

      <Card size="small" title="当前版本" style={{ marginBottom: 12 }}>
        <Descriptions size="small" column={2}>
          <Descriptions.Item label="应用版本">
            <Text code>{current?.app_version ?? '—'}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="机器指纹 (fp-installer)">
            {current?.installer_fp ? (
              <Space size="small">
                <Tag>{current.installer_fp.arch}</Tag>
                <Tag>{current.installer_fp.osMajor}</Tag>
                <Tag>{current.installer_fp.ramBucket}</Tag>
              </Space>
            ) : (
              <Text type="secondary">(Day 3 后端就绪后显示)</Text>
            )}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card size="small" title=".wupd 升级包" style={{ marginBottom: 12 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Upload
            beforeUpload={() => false}
            maxCount={1}
            accept=".wupd"
            fileList={file ? [file] : []}
            onChange={({ fileList }) => {
              setFile(fileList[0] ?? null);
              setPreview(null);
              setPreviewError(null);
            }}
          >
            <Button>选择 .wupd 文件</Button>
          </Upload>
          {file && (
            <Space>
              <Button type="primary" size="small" loading={previewing} onClick={() => void handlePreview()}>
                预览 manifest
              </Button>
              {preview && (
                <Tooltip title={!backendReady ? 'M11 Day 3-4 后端就绪才可用' : undefined}>
                  <Popconfirm
                    title="开始升级"
                    description={`从 ${preview.from_version} → ${preview.to_version} · 约 3-5 分钟 · 失败自动回滚`}
                    okText="确认升级"
                    okButtonProps={{ danger: true, disabled: !backendReady }}
                    cancelText="取消"
                    onConfirm={() => void handleApply()}
                    disabled={!backendReady}
                  >
                    <Button danger size="small" disabled={!backendReady}>
                      应用升级
                    </Button>
                  </Popconfirm>
                </Tooltip>
              )}
            </Space>
          )}
          {previewError && <Alert type="error" showIcon message={previewError} />}
        </Space>
      </Card>

      {preview && (
        <Card size="small" title="Manifest 预览" style={{ marginBottom: 12 }}>
          <Descriptions size="small" column={2} bordered>
            <Descriptions.Item label="from">{preview.from_version}</Descriptions.Item>
            <Descriptions.Item label="to">{preview.to_version}</Descriptions.Item>
            <Descriptions.Item label="created">
              {new Date(preview.created_at).toLocaleString('zh-CN')}
            </Descriptions.Item>
            <Descriptions.Item label="app_sha256">
              <Text code style={{ fontSize: 10 }}>{preview.app_sha256.slice(0, 16)}…</Text>
            </Descriptions.Item>
            <Descriptions.Item label="签名校验" span={2}>
              {preview.signature_valid === true ? (
                <Tag color="success">✓ ed25519 验证通过</Tag>
              ) : preview.signature_valid === false ? (
                <Tag color="error">✗ 签名无效 ({preview.signature_fail_code ?? 'UNKNOWN'})</Tag>
              ) : (
                <Tag color="default">Day 3 backend 就绪后显示</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="版本兼容" span={2}>
              {preview.version_compat === 'ok' && <Tag color="success">PATCH/MINOR · 自动升级</Tag>}
              {preview.version_compat === 'major-bump' && (
                <Tag color="warning">MAJOR bump · 用户确认</Tag>
              )}
              {preview.version_compat === 'same' && <Tag>same version · 无需升级</Tag>}
              {preview.version_compat === 'downgrade' && (
                <Tag color="error">downgrade · 拒绝</Tag>
              )}
              {!preview.version_compat && <Tag color="default">Day 3 显示</Tag>}
            </Descriptions.Item>
            <Descriptions.Item label="health_check" span={2}>
              <Text code style={{ fontSize: 11 }}>
                {preview.health_check.endpoint} · expect {preview.health_check.expect_status} · timeout{' '}
                {preview.health_check.timeout_sec}s
              </Text>
            </Descriptions.Item>
            <Descriptions.Item label="rollback strategy" span={2}>
              <Tag>{preview.rollback.strategy}</Tag>
            </Descriptions.Item>
          </Descriptions>
          <Paragraph strong style={{ marginTop: 12 }}>
            Migrations ({preview.migrations.length})
          </Paragraph>
          <List
            size="small"
            bordered
            dataSource={preview.migrations}
            renderItem={(m) => (
              <List.Item>
                <Space>
                  <Tag>{m.name}</Tag>
                  <Text code style={{ fontSize: 10 }}>{m.sha256.slice(0, 12)}…</Text>
                </Space>
              </List.Item>
            )}
          />
        </Card>
      )}

      {/* Apply 进度 modal · 真升级会让 backend 断线, 最终 UI 靠用户刷新登录 */}
      <Modal
        title="升级中"
        open={applyOpen}
        footer={null}
        closable={phase === 'done' || phase === 'rollback'}
        onCancel={() => setApplyOpen(false)}
        destroyOnClose={false}
        width={640}
      >
        <Steps
          direction="vertical"
          current={currentStepIdx < 0 ? 0 : currentStepIdx}
          status={phase === 'rollback' ? 'error' : phase === 'done' ? 'finish' : 'process'}
          items={stepItems}
        />
        <Progress
          percent={Math.round(((currentStepIdx + 1) / PHASE_ORDER.length) * 100)}
          status={phase === 'rollback' ? 'exception' : phase === 'done' ? 'success' : 'active'}
          style={{ marginTop: 12 }}
        />
        {phase === 'rollback' && (
          <Result
            status="error"
            title="升级失败 · 已回滚"
            subTitle={phaseError ?? '数据已恢复到升级前 · 详情见 data/logs/upgrade-*.log'}
            extra={<Button onClick={() => { setApplyOpen(false); setPhase('idle'); setFile(null); setPreview(null); }}>关闭</Button>}
          />
        )}
        {phase === 'done' && (
          <Result
            status="success"
            title="升级完成"
            subTitle={`${preview?.from_version} → ${preview?.to_version} · 请刷新页面重新登录`}
            extra={<Button type="primary" onClick={() => window.location.reload()}>刷新页面</Button>}
          />
        )}
      </Modal>
    </Card>
  );
}

function phaseLabel(p: ApplyPhase): string {
  const labels: Record<ApplyPhase, string> = {
    idle: '准备',
    verifying: '1. 签名校验',
    'pre-backup': '2. 自动备份 (.wab + app/)',
    stopping: '3. 停服 (X1+ 优雅 10min)',
    replacing: '4. 替换 app/',
    migrating: '5. 数据库 migration',
    starting: '6. 启动新版',
    'health-check': '7. 健康检查',
    done: '✓ 完成',
    rollback: '✗ 回滚',
  };
  return labels[p];
}

function phaseDescription(p: ApplyPhase): string {
  const descs: Record<ApplyPhase, string> = {
    idle: '',
    verifying: 'Ed25519 + app_sha256',
    'pre-backup': '复用 M10 export · pre-update/<from>_<ts>/',
    stopping: '新任务拒 · running 等完成 · >10min 强杀 interrupted',
    replacing: 'installer 外壳 atomic rename',
    migrating: 'TypeORM onModuleInit · Y2+ error log file',
    starting: 'backend 新版进程起',
    'health-check': 'GET /health · 60s timeout · 200 expect',
    done: 'backend 自行重启 · UI 需刷新',
    rollback: 'app/ 恢复 + .wab restore · 数据安全',
  };
  return descs[p];
}
