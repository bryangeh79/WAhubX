import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Space, Spin, Tag, Typography } from 'antd';
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

export function BindExistingModal({ slotId, slotIndex, open, onClose, onSuccess }: Props) {
  const [status, setStatus] = useState<BindStatus | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasStartedRef = useRef(false);

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
      const res = await api.post<BindStatus>(`/slots/${slotId}/bind-existing`);
      setStatus(res.data);
      if (!pollRef.current) {
        pollRef.current = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
      }
    } catch (err) {
      setBootError(extractErrorMessage(err, '启动绑定失败'));
    }
  }, [slotId, poll]);

  const cancel = useCallback(async () => {
    stopPolling();
    try {
      await api.post(`/slots/${slotId}/bind-existing/cancel`);
    } catch {
      // 后端已自清理 or 网络错误, 忽略
    }
    onClose();
  }, [slotId, stopPolling, onClose]);

  // 打开 → 启动一次; 关闭 → 清 poller
  useEffect(() => {
    if (open && !hasStartedRef.current) {
      hasStartedRef.current = true;
      void start();
    }
    if (!open) {
      hasStartedRef.current = false;
      stopPolling();
      setStatus(null);
      setQrDataUrl(null);
      setBootError(null);
    }
    return stopPolling;
  }, [open, start, stopPolling]);

  // QR string → PNG data URL
  useEffect(() => {
    if (!status?.qr) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(status.qr, { margin: 1, width: 280 })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch((err) => { if (!cancelled) setBootError('QR 渲染失败: ' + String(err)); });
    return () => { cancelled = true; };
  }, [status?.qr]);

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

      {!status || status.state === 'starting' ? (
        <CenterSpin tip="初始化 Baileys 连接..." />
      ) : status.state === 'qr' ? (
        <QrStage qrDataUrl={qrDataUrl} />
      ) : status.state === 'connecting' ? (
        <CenterSpin tip="扫码成功, 正在完成握手..." />
      ) : status.state === 'connected' ? (
        <ConnectedStage phone={status.phoneNumber} onClose={onClose} />
      ) : (
        <TerminalStage state={status.state} error={status.error} onRetry={() => void start()} onClose={onClose} />
      )}
    </Modal>
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
        请在 WhatsApp → <Text strong>设置 → 已链接的设备 → 链接设备</Text> 扫描下方二维码:
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

function ConnectedStage({ phone, onClose }: { phone: string | null; onClose: () => void }) {
  return (
    <div style={{ textAlign: 'center', padding: '24px 0' }}>
      <Title level={4} style={{ color: '#52c41a', marginBottom: 8 }}>✓ 绑定成功</Title>
      <Paragraph>
        手机号: <Text strong>{phone ?? '—'}</Text>
      </Paragraph>
      <Paragraph type="secondary">
        槽位状态已更新为 "养号中" (warmup). M5 养号日历实装后会自动排日程.
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
