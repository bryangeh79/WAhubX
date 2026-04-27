// 2026-04-26 · P0.10++ · 系统内嵌接管窗口
// 客服 chrome 窗口的实时画面 · 不再桌面外部窗口
// CDP screencast frames → backend gateway → 5173 socket.io → <canvas>
// 反向 mouse/key → socket.io → backend → CDP Input.dispatch
import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { Spin, Typography } from 'antd';
import { getAccessToken } from '@/lib/api';

const { Text } = Typography;

interface FramePayload {
  slotId: number;
  ts: number;
  data: string; // base64 (no prefix)
  mime: 'image/jpeg' | 'image/webp' | 'image/png';
  width: number;
  height: number;
}

interface Props {
  slotId: number;
  /** 要不要启 input 反向 (mouse/key) · default true */
  enableInput?: boolean;
}

export function TakeoverEmbeddedWindow({ slotId, enableInput = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [framesReceived, setFramesReceived] = useState(0);
  const [error, setError] = useState<string | null>(null);
  // canvas natural size (set on first frame · 用于坐标换算)
  const [imgSize, setImgSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setError('未登录 · 无 access token');
      return;
    }
    // 连 backend socket.io /screencast namespace (跟 TakeoverTab 同款 io('/namespace'))
    // vite proxy 会把 /socket.io 转发到 backend 9700
    const ns = io('/screencast', {
      transports: ['websocket', 'polling'],
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });
    socketRef.current = ns;

    ns.on('connect', () => {
      setConnected(true);
      setError(null);
      // 订阅 slot frames
      ns.emit('subscribe', { slotId }, (resp: { ok: boolean; error?: string }) => {
        if (!resp?.ok) {
          setError(resp?.error ?? 'subscribe 失败');
        }
      });
    });
    ns.on('disconnect', () => {
      setConnected(false);
    });
    ns.on('connect_error', (err: Error) => {
      setError(`连接失败: ${err.message}`);
    });
    ns.on('frame', (payload: FramePayload) => {
      if (payload.slotId !== slotId) return;
      const cv = canvasRef.current;
      if (!cv) return;
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      // 2026-04-26 · P0.10++ fix · 用 payload.width/height (CDP CSS viewport pixel)
      // 不是 img.width (jpeg device pixel · DPR 漂移会让 mouse 坐标偏 2 倍)
      const targetW = payload.width || 1280;
      const targetH = payload.height || 800;
      const img = new Image();
      img.onload = () => {
        if (!imgSize || imgSize.width !== targetW || imgSize.height !== targetH) {
          setImgSize({ width: targetW, height: targetH });
          cv.width = targetW;
          cv.height = targetH;
        }
        // drawImage 强 stretch 到 CSS pixel 尺寸 · 保持 1:1 与 CDP 坐标对齐
        ctx.drawImage(img, 0, 0, targetW, targetH);
      };
      img.src = `data:${payload.mime};base64,${payload.data}`;
      setFramesReceived((c) => c + 1);
    });

    return () => {
      try {
        ns.emit('unsubscribe', { slotId });
        ns.disconnect();
        socket.disconnect();
      } catch {
        /* ignore */
      }
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotId]);

  // input 反向: canvas mouse / keyboard event → socket.io
  useEffect(() => {
    if (!enableInput) return;
    const cv = canvasRef.current;
    if (!cv) return;

    const sendInput = (event: unknown) => {
      socketRef.current?.emit('input', { slotId, event });
    };
    const toCanvasCoord = (e: MouseEvent): { x: number; y: number } => {
      const rect = cv.getBoundingClientRect();
      const scaleX = cv.width / rect.width;
      const scaleY = cv.height / rect.height;
      return {
        x: Math.round((e.clientX - rect.left) * scaleX),
        y: Math.round((e.clientY - rect.top) * scaleY),
      };
    };

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      cv.focus();
      const c = toCanvasCoord(e);
      sendInput({ kind: 'mouse', type: 'mousePressed', x: c.x, y: c.y, button: 'left', clickCount: e.detail });
    };
    const onMouseUp = (e: MouseEvent) => {
      const c = toCanvasCoord(e);
      sendInput({ kind: 'mouse', type: 'mouseReleased', x: c.x, y: c.y, button: 'left', clickCount: e.detail });
    };
    const onMouseMove = (e: MouseEvent) => {
      const c = toCanvasCoord(e);
      sendInput({ kind: 'mouse', type: 'mouseMoved', x: c.x, y: c.y });
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const c = toCanvasCoord(e);
      sendInput({ kind: 'mouse', type: 'mouseWheel', x: c.x, y: c.y, deltaX: e.deltaX, deltaY: e.deltaY });
    };
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      sendInput({ kind: 'key', type: 'keyDown', key: e.key, code: e.code, text: e.key.length === 1 ? e.key : undefined });
    };
    const onKeyUp = (e: KeyboardEvent) => {
      sendInput({ kind: 'key', type: 'keyUp', key: e.key, code: e.code });
    };

    cv.addEventListener('mousedown', onMouseDown);
    cv.addEventListener('mouseup', onMouseUp);
    cv.addEventListener('mousemove', onMouseMove);
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('keydown', onKeyDown);
    cv.addEventListener('keyup', onKeyUp);
    cv.tabIndex = 0; // 让 canvas 可聚焦接键盘事件

    return () => {
      cv.removeEventListener('mousedown', onMouseDown);
      cv.removeEventListener('mouseup', onMouseUp);
      cv.removeEventListener('mousemove', onMouseMove);
      cv.removeEventListener('wheel', onWheel);
      cv.removeEventListener('keydown', onKeyDown);
      cv.removeEventListener('keyup', onKeyUp);
    };
  }, [slotId, enableInput, imgSize]);

  return (
    <div style={{ width: '100%', minHeight: 360, position: 'relative', background: '#000', borderRadius: 8, overflow: 'hidden' }}>
      {!connected && !error && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
          <Spin tip="正在连接接管窗口..." size="large" />
        </div>
      )}
      {error && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: '#fff', padding: 20 }}>
          <Text style={{ color: '#fff' }}>⚠ {error}</Text>
        </div>
      )}
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          maxWidth: '100%',
          maxHeight: '70vh',
          margin: '0 auto',
          cursor: 'crosshair',
          background: '#000',
        }}
      />
      {framesReceived > 0 && (
        <div style={{ position: 'absolute', top: 4, right: 8, fontSize: 11, color: '#888', background: 'rgba(0,0,0,0.5)', padding: '2px 6px', borderRadius: 4 }}>
          frames: {framesReceived}
        </div>
      )}
    </div>
  );
}
