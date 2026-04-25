// 2026-04-25 · D8-1 · Runtime → Backend WS 客户端
//
// 职责:
//   - 连 backend 控制面 WS endpoint (CONTROL_PLANE_WS_URL)
//   - WS handshake 鉴权 · query string 带 token + slotId + tenantId
//   - 重连 (指数退避 + jitter)
//   - 心跳 30s
//   - 消息分发: 命令 → handler · ACK / 事件 → 出
//   - 优雅关闭 (shutdown 命令收到后 client 主动 close)
//
// 不在 D8-1 范围 (D8-2 加):
//   - 命令 handler 实装 (init/start-bind/etc)
//   - 真事件推 (qr/bind-state/etc)
//
// D8-1 只验"通"路径: 连得上 + 鉴权过 + 心跳来回 + 优雅 close

import WebSocket from 'ws';
import type { Logger } from 'pino';
import {
  RUNTIME_HEARTBEAT_INTERVAL_MS,
  RUNTIME_RECONNECT_BASE_MS,
  RUNTIME_RECONNECT_MAX_MS,
  RUNTIME_RECONNECT_JITTER,
  RUNTIME_PROTOCOL_VERSION,
  type RuntimeCommand,
  type RuntimeMessage,
  type HeartbeatEvent,
} from './protocol/runtime-protocol';

export interface RuntimeWsClientOptions {
  controlPlaneUrl: string; // ws://localhost:9700/runtime
  authToken: string;
  slotId: number;
  tenantId: number;
  log: Logger;
  /** 可选 · 当前页面状态供应商 · backend 心跳里要 */
  getPageState?: () => HeartbeatEvent['pageState'];
  /** 可选 · 命令 handler · D8-2 才有真实装 · D8-1 只接 ack 测试 */
  onCommand?: (cmd: RuntimeCommand) => Promise<{ ok: boolean; error?: string; data?: unknown }>;
}

export class RuntimeWsClient {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private startedAt = Date.now();
  private intentionalClose = false;
  private connectedAtLeastOnce = false;

  constructor(private opts: RuntimeWsClientOptions) {}

  start(): void {
    this.intentionalClose = false;
    this.connect();
  }

  /**
   * 显式关闭 · 不重连
   */
  async stop(): Promise<void> {
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.reconnectTimer = null;
    this.heartbeatTimer = null;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, 'runtime intentional close');
      // 等 close 落地 · 最多 2s
      await new Promise<void>((r) => {
        const timer = setTimeout(() => r(), 2000);
        this.ws?.once('close', () => {
          clearTimeout(timer);
          r();
        });
      });
    }
    this.ws = null;
  }

  /**
   * 主动推事件给 backend
   */
  emitEvent(evt: Omit<RuntimeMessage, 'kind'> & { kind: 'event' }): void {
    this.send(evt);
  }

  /**
   * 主动推 ACK (命令回执 · 命令 handler 内部调)
   */
  sendAck(requestId: string, ok: boolean, data?: unknown, error?: string): void {
    this.send({ kind: 'ack', requestId, ok, error, data });
  }

  isConnected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  // ═══ private ════════════════════════════════════════════════════
  private connect(): void {
    const url = this.buildHandshakeUrl();
    this.opts.log.info(
      {
        url: url.replace(/token=[^&]+/, 'token=***'),
        attempt: this.reconnectAttempts,
      },
      'D8-1 WS client connecting',
    );

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this.opts.log.error({ err: err instanceof Error ? err.message : err }, 'WS construct failed');
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on('open', () => {
      this.reconnectAttempts = 0;
      this.connectedAtLeastOnce = true;
      this.opts.log.info(
        { slotId: this.opts.slotId, protocolVersion: RUNTIME_PROTOCOL_VERSION },
        'D8-1 WS client OPEN · 鉴权通过',
      );
      this.startHeartbeat();
    });

    ws.on('message', (data: WebSocket.RawData) => {
      void this.handleIncoming(data);
    });

    ws.on('error', (err) => {
      this.opts.log.warn(
        { err: err.message, attempt: this.reconnectAttempts },
        'D8-1 WS client error',
      );
    });

    ws.on('close', (code, reason) => {
      this.stopHeartbeat();
      this.ws = null;
      const reasonStr = reason?.toString() ?? '';
      this.opts.log.warn(
        { code, reason: reasonStr, intentional: this.intentionalClose },
        'D8-1 WS client CLOSE',
      );
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    });
  }

  private buildHandshakeUrl(): string {
    const base = this.opts.controlPlaneUrl.replace(/\/$/, '');
    const params = new URLSearchParams({
      token: this.opts.authToken,
      slotId: String(this.opts.slotId),
      tenantId: String(this.opts.tenantId),
      protocol: String(RUNTIME_PROTOCOL_VERSION),
    });
    return `${base}?${params.toString()}`;
  }

  private async handleIncoming(data: WebSocket.RawData): Promise<void> {
    let parsed: RuntimeMessage;
    try {
      parsed = JSON.parse(data.toString()) as RuntimeMessage;
    } catch (err) {
      this.opts.log.warn(
        { err: err instanceof Error ? err.message : err, len: data.toString().length },
        'WS recv: JSON parse failed',
      );
      return;
    }

    if (parsed.kind === 'cmd') {
      // 命令 → 调 handler · D8-1 没真 handler · 默认 noop ACK
      if (!this.opts.onCommand) {
        this.opts.log.info(
          { type: parsed.type, requestId: parsed.requestId },
          'cmd received · no handler in D8-1 · noop ack',
        );
        this.sendAck(parsed.requestId, true, { noop: true });
        return;
      }
      try {
        const result = await this.opts.onCommand(parsed);
        this.sendAck(parsed.requestId, result.ok, result.data, result.error);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.opts.log.error({ err: errMsg, type: parsed.type }, 'cmd handler threw');
        this.sendAck(parsed.requestId, false, undefined, errMsg);
      }
      return;
    }

    // ACK / event 是 runtime → backend 单向 · 不应该收到
    this.opts.log.warn({ kind: parsed.kind }, 'unexpected message kind from backend');
  }

  private send(msg: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.opts.log.warn({ ready: this.ws?.readyState ?? 'null' }, 'WS not open · drop msg');
      return;
    }
    try {
      this.ws.send(JSON.stringify(msg));
    } catch (err) {
      this.opts.log.error({ err: err instanceof Error ? err.message : err }, 'WS send failed');
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const evt: HeartbeatEvent = {
        kind: 'event',
        type: 'heartbeat',
        slotId: this.opts.slotId,
        ts: Date.now(),
        pageState: this.opts.getPageState ? this.opts.getPageState() : 'unknown',
        uptimeMs: Date.now() - this.startedAt,
      };
      this.send(evt);
    }, RUNTIME_HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose) return;
    this.reconnectAttempts += 1;
    // base × 2^(n-1) · clamp 到 max
    const expo = RUNTIME_RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts - 1);
    const baseDelay = Math.min(expo, RUNTIME_RECONNECT_MAX_MS);
    // ±30% jitter
    const jitter = baseDelay * RUNTIME_RECONNECT_JITTER * (Math.random() * 2 - 1);
    const delay = Math.max(500, Math.round(baseDelay + jitter));
    this.opts.log.info(
      { attempt: this.reconnectAttempts, delayMs: delay },
      'D8-1 WS client schedule reconnect',
    );
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
