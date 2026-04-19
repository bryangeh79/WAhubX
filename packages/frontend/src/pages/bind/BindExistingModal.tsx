import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Modal, Radio, Space, Spin, Tag, Typography } from 'antd';
import QRCode from 'qrcode';
import { api, extractErrorMessage } from '@/lib/api';

const { Title, Paragraph, Text } = Typography;

type BindState =
  | 'idle'
  | 'starting'
  | 'qr'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'cancelled'
  | 'timeout';

interface BindStatus {
  state: BindState;
  qr: string | null;
  pairingCode: string | null;
  mode: 'qr' | 'pairing-code';
  phoneNumber: string | null;
  startedAt: string;
  lastEventAt: string;
  error: string | null;
}

interface Props {
  slotId: number;
  slotIndex: number;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const TERMINAL_STATES: BindState[] = ['connected', 'failed', 'cancelled', 'timeout'];
const POLL_INTERVAL_MS = 1500;

type Mode = 'qr' | 'pairing-code';

export function BindExistingModal({ slotId, slotIndex, open, onClose, onSuccess }: Props) {
  const [mode, setMode] = useState<Mode>('qr');
  const [phoneInput, setPhoneInput] = useState('');
  const [started, setStarted] = useState(false);
  const [status, setStatus] = useState<BindStatus | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const res = await api.get<BindStatus>(`/slots/${slotId}/bind-existing/status`);
      setStatus(res.data);
      if (TERMINAL_STATES.includes(res.data.state)) {
        stopPolling();
        if (res.data.state === 'connected') onSuccess();
      }
    } catch (err) {
      setBootError(extractErrorMessage(err, '轮询状态失败'));
      stopPolling();
    }
  }, [slotId, stopPolling, onSuccess]);

  const start = useCallback(async () => {
    setBootError(null);
    try {
      const body = mode === 'pairing-code' ? { phoneNumber: phoneInput.trim() } : {};
      const res = await api.post<BindStatus>(`/slots/${slotId}/bind-existing`, body);
      setStatus(res.data);
      setStarted(true);
      if (!pollRef.current) {
        pollRef.current = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
      }
    } catch (err) {
      setBootError(extractErrorMessage(err, '启动绑定失败'));
    }
  }, [slotId, poll, mode, phoneInput]);

  const cancel = useCallback(async () => {
    stopPolling();
    try {
      if (started) await api.post(`/slots/${slotId}/bind-existing/cancel`);
    } catch {
      // 已自清理
    }
    onClose();
  }, [slotId, stopPolling, onClose, started]);

  useEffect(() => {
    if (!open) {
      setStarted(false);
      stopPolling();
      setStatus(null);
      setQrDataUrl(null);
      setBootError(null);
      setMode('qr');
      setPhoneInput('');
    }
    return stopPolling;
  }, [open, stopPolling]);

  useEffect(() => {
    if (!status?.qr || status.mode !== 'qr') {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(status.qr, { margin: 1, width: 280 })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch((err) => { if (!cancelled) setBootError('QR 渲染失败: ' + String(err)); });
    return () => { cancelled = true; };
  }, [status?.qr, status?.mode]);

  return (
    <Modal
      title={`绑定现有 WhatsApp 号 · 槽位 #${slotIndex}`}
      open={open}
      onCancel={() => void cancel()}
      footer={null}
      width={480}
      destroyOnClose
      maskClosable={false}
    >
      {bootError && <Alert type="error" message={bootError} showIcon style={{ marginBottom: 12 }} />}

      {!started ? (
        <ModePicker
          mode={mode}
          onModeChange={setMode}
          phoneInput={phoneInput}
          onPhoneChange={setPhoneInput}
          onStart={() => void start()}
        />
      ) : !status || status.state === 'starting' ? (
        <CenterSpin tip="初始化 Baileys 连接..." />
      ) : status.state === 'qr' ? (
        status.mode === 'pairing-code' ? (
          <PairingCodeStage code={status.pairingCode} />
        ) : (
          <QrStage qrDataUrl={qrDataUrl} />
        )
      ) : status.state === 'connecting' ? (
        <CenterSpin tip="扫码/配对成功, 正在完成握手..." />
      ) : status.state === 'connected' ? (
        <ConnectedStage phone={status.phoneNumber} onClose={onClose} />
      ) : (
        <TerminalStage
          state={status.state}
          error={status.error}
          onRetry={() => {
            setStarted(false);
            setStatus(null);
          }}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}

function ModePicker({
  mode,
  onModeChange,
  phoneInput,
  onPhoneChange,
  onStart,
}: {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  phoneInput: string;
  onPhoneChange: (v: string) => void;
  onStart: () => void;
}) {
  const canStart = mode === 'qr' || (mode === 'pairing-code' && /^\d{8,15}$/.test(phoneInput.trim()));
  return (
    <div>
      <Paragraph>选择绑定方式:</Paragraph>
      <Radio.Group
        value={mode}
        onChange={(e) => onModeChange(e.target.value)}
        style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}
      >
        <Radio value="qr">
          <Space direction="vertical" size={2}>
            <Text strong>扫描二维码</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              手机 WA → 设置 → 已链接的设备 → 链接设备 → 扫码
            </Text>
          </Space>
        </Radio>
        <Radio value="pairing-code">
          <Space direction="vertical" size={2}>
            <Text strong>配对码 (手机号链接)</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              摄像头不方便时用. 手机 WA → 设置 → 已链接的设备 → 链接设备 → <Text strong>用手机号连接</Text> → 输入 8 位码
            </Text>
          </Space>
        </Radio>
      </Radio.Group>
      {mode === 'pairing-code' && (
        <div style={{ marginBottom: 12 }}>
          <Paragraph style={{ marginBottom: 4 }}>
            <Text strong>手机号 (带国家码, 不含 +):</Text>
          </Paragraph>
          <Input
            placeholder="60123456789"
            value={phoneInput}
            onChange={(e) => onPhoneChange(e.target.value)}
            size="large"
          />
          <Text type="secondary" style={{ fontSize: 11 }}>
            例: 马来西亚 60xxx, 新加坡 65xxx. 8-15 位纯数字.
          </Text>
        </div>
      )}
      <Button type="primary" size="large" block onClick={onStart} disabled={!canStart}>
        开始
      </Button>
    </div>
  );
}

function CenterSpin({ tip }: { tip: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '40px 0' }}>
      <Spin size="large" tip={tip} />
    </div>
  );
}

function QrStage({ qrDataUrl }: { qrDataUrl: string | null }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <Paragraph>
        WhatsApp → <Text strong>设置 → 已链接的设备 → 链接设备</Text> → 扫码:
      </Paragraph>
      {qrDataUrl ? (
        <div style={{ display: 'inline-block', padding: 16, background: '#fff', border: '1px solid #eee', borderRadius: 8 }}>
          <img src={qrDataUrl} alt="WhatsApp QR Code" width={280} height={280} />
        </div>
      ) : (
        <CenterSpin tip="生成二维码..." />
      )}
      <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12 }}>
        二维码每 ~20 秒自动刷新 · 2 分钟内未扫描会超时
      </Paragraph>
    </div>
  );
}

function PairingCodeStage({ code }: { code: string | null }) {
  return (
    <div style={{ textAlign: 'center', padding: '16px 0' }}>
      <Paragraph>
        WhatsApp → <Text strong>设置 → 已链接的设备 → 链接设备 → 用手机号连接</Text> → 输入下方 8 位码:
      </Paragraph>
      {code ? (
        <div
          style={{
            display: 'inline-block',
            padding: '20px 32px',
            background: '#f0f9ff',
            border: '2px dashed #25d366',
            borderRadius: 8,
            fontSize: 28,
            fontWeight: 700,
            fontFamily: 'monospace',
            letterSpacing: 4,
            margin: '8px 0',
          }}
        >
          {code}
        </div>
      ) : (
        <CenterSpin tip="生成配对码..." />
      )}
      <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12 }}>
        配对码大小写不敏感 · 约 60 秒内有效 · 2 分钟内未完成会超时
      </Paragraph>
    </div>
  );
}

function ConnectedStage({ phone, onClose }: { phone: string | null; onClose: () => void }) {
  return (
    <div style={{ textAlign: 'center', padding: '24px 0' }}>
      <Title level={4} style={{ color: '#52c41a', marginBottom: 8 }}>✓ 绑定成功</Title>
      <Paragraph>
        手机号: <Text strong>{phone ?? '—'}</Text>
      </Paragraph>
      <Paragraph type="secondary">
        槽位状态已更新为 "养号中" (warmup). Socket 已常驻 pool, 可直接收发消息.
      </Paragraph>
      <Button type="primary" onClick={onClose}>完成</Button>
    </div>
  );
}

function TerminalStage({
  state,
  error,
  onRetry,
  onClose,
}: {
  state: BindState;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}) {
  const meta = {
    failed: { color: 'error' as const, label: '失败' },
    cancelled: { color: 'default' as const, label: '已取消' },
    timeout: { color: 'warning' as const, label: '超时' },
  }[state as 'failed' | 'cancelled' | 'timeout'];

  return (
    <div style={{ textAlign: 'center', padding: '24px 0' }}>
      <Tag color={meta.color} style={{ fontSize: 14, padding: '4px 12px' }}>{meta.label}</Tag>
      {error && <Paragraph type="secondary" style={{ marginTop: 12 }}>{error}</Paragraph>}
      <Space style={{ marginTop: 16 }}>
        <Button onClick={onClose}>关闭</Button>
        <Button type="primary" onClick={onRetry}>重试</Button>
      </Space>
    </div>
  );
}
