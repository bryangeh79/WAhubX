// 2026-04-25 · D8-1 · Backend WS Gateway · Runtime ↔ Backend 控制面桥
//
// 职责:
//   - 起 WebSocketServer (默认 port 9711) 听 runtime 进来连
//   - handshake 鉴权: query 带 token + slotId + tenantId · 校 token + 注册连接
//   - 维护 Map<slotId, ClientConn> · 同 slotId 重连时踢老的 (one-conn-per-slot)
//   - 命令下发: sendCommand(slotId, cmd) · 等 ACK · 30s 超时
//   - 事件转发: 收到 runtime 事件 → 通过 EventEmitter2 推 'runtime.bridge.<type>' 给业务模块
//
// D8-1 验收:
//   - runtime 起容器 + 连进来 + 鉴权过 + 心跳出现在 backend log
//   - 优雅 stop(): backend 重启 / runtime 重启都不打挂对方

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import * as http from 'node:http';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import {
  RUNTIME_CMD_ACK_TIMEOUT_MS,
  RUNTIME_PROTOCOL_VERSION,
  eventName,
  type RuntimeCommand,
  type RuntimeMessage,
  type RuntimeAck,
  type RuntimeEvent,
} from './runtime-protocol';

interface ClientConn {
  ws: WebSocket;
  slotId: number;
  tenantId: number;
  connectedAt: number;
  lastHeartbeatAt: number;
  lastPageState: string | null;
}

interface PendingRequest {
  resolve: (ack: RuntimeAck) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

@Injectable()
export class RuntimeBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RuntimeBridgeService.name);
  private wss: WebSocketServer | null = null;
  private httpServer: http.Server | null = null;
  private readonly clients = new Map<number, ClientConn>();
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  async onModuleInit(): Promise<void> {
    const enabled = this.config.get<string>('RUNTIME_BRIDGE_ENABLED', 'true');
    if (enabled === 'false') {
      this.logger.log('RuntimeBridgeService disabled via RUNTIME_BRIDGE_ENABLED=false');
      return;
    }

    const port = Number(this.config.get('RUNTIME_BRIDGE_PORT', '9711'));
    const host = this.config.get<string>('RUNTIME_BRIDGE_HOST', '0.0.0.0');
    const path = this.config.get<string>('RUNTIME_BRIDGE_PATH', '/runtime');

    // 用独立 http server (而不是 attach 到主 NestJS http) ·
    // 原因: 控制面 ws 是给本地 runtime 子进程用的 · 不该跟外部 API 共端口
    this.httpServer = http.createServer((req, res) => {
      // 不应有 HTTP 流量 · 走 WS upgrade 才合法
      res.writeHead(404);
      res.end('runtime-bridge: WS upgrade only');
    });
    this.wss = new WebSocketServer({
      server: this.httpServer,
      path,
      maxPayload: 8 * 1024 * 1024, // 8MB · 容纳 QR dataUrl
    });

    this.wss.on('connection', (ws, req) => this.handleConnection(ws, req));
    this.wss.on('error', (err) => {
      this.logger.error(`WSS error: ${err.message}`, err.stack);
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer!.once('error', reject);
      this.httpServer!.listen(port, host, () => {
        this.httpServer!.off('error', reject);
        resolve();
      });
    });
    this.logger.log(
      `D8-1 RuntimeBridge listening on ws://${host}:${port}${path} · protocol v${RUNTIME_PROTOCOL_VERSION}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('RuntimeBridge shutting down · closing all client connections');
    for (const [slotId, conn] of this.clients.entries()) {
      try {
        conn.ws.close(1001, 'backend shutdown');
      } catch {
        /* ignore */
      }
      this.clients.delete(slotId);
    }
    if (this.wss) {
      await new Promise<void>((resolve) => this.wss!.close(() => resolve()));
      this.wss = null;
    }
    if (this.httpServer) {
      await new Promise<void>((resolve) => this.httpServer!.close(() => resolve()));
      this.httpServer = null;
    }
  }

  // ═══ 公共 API · 给业务模块用 ════════════════════════════════════
  hasConnection(slotId: number): boolean {
    return this.clients.has(slotId);
  }

  getConnectedSlots(): number[] {
    return Array.from(this.clients.keys());
  }

  /**
   * 下发命令 · 等 ACK · 30s 超时.
   */
  async sendCommand<T = unknown>(slotId: number, cmd: Omit<RuntimeCommand, 'requestId'>): Promise<T> {
    const conn = this.clients.get(slotId);
    if (!conn) {
      throw new Error(`runtime not connected for slot ${slotId}`);
    }
    const requestId = crypto.randomBytes(8).toString('hex');
    const fullCmd = { ...cmd, requestId } as RuntimeCommand;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`runtime cmd ${cmd.type} timeout after ${RUNTIME_CMD_ACK_TIMEOUT_MS}ms`));
      }, RUNTIME_CMD_ACK_TIMEOUT_MS);

      this.pending.set(requestId, {
        resolve: (ack) => {
          clearTimeout(timer);
          if (ack.ok) {
            resolve(ack.data as T);
          } else {
            reject(new Error(ack.error ?? `cmd ${cmd.type} failed`));
          }
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        timer,
      });

      try {
        conn.ws.send(JSON.stringify(fullCmd));
      } catch (err) {
        this.pending.delete(requestId);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  // ═══ private · 连接处理 ═════════════════════════════════════════
  private handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const url = new URL(req.url ?? '/', 'http://x');
    const token = url.searchParams.get('token') ?? '';
    const slotIdRaw = url.searchParams.get('slotId') ?? '';
    const tenantIdRaw = url.searchParams.get('tenantId') ?? '';
    const protocolRaw = url.searchParams.get('protocol') ?? '';

    const expectedToken = this.config.get<string>('RUNTIME_AUTH_TOKEN', 'dev-runtime-token');

    // ─── 鉴权 ────────────────────────────────────────
    if (!token || token !== expectedToken) {
      this.logger.warn(
        `WS handshake rejected · invalid token (got len=${token.length}) · remote=${req.socket.remoteAddress}`,
      );
      ws.close(4001, 'invalid token');
      return;
    }
    const slotId = parseInt(slotIdRaw, 10);
    const tenantId = parseInt(tenantIdRaw, 10);
    if (!Number.isFinite(slotId) || slotId <= 0) {
      this.logger.warn(`WS handshake rejected · bad slotId=${slotIdRaw}`);
      ws.close(4002, 'bad slotId');
      return;
    }
    if (!Number.isFinite(tenantId) || tenantId <= 0) {
      this.logger.warn(`WS handshake rejected · bad tenantId=${tenantIdRaw}`);
      ws.close(4003, 'bad tenantId');
      return;
    }
    const protocol = parseInt(protocolRaw, 10);
    if (protocol !== RUNTIME_PROTOCOL_VERSION) {
      this.logger.warn(`WS handshake rejected · protocol mismatch · got=${protocolRaw} want=${RUNTIME_PROTOCOL_VERSION}`);
      ws.close(4004, 'protocol mismatch');
      return;
    }

    // ─── 替换旧连接 (one-conn-per-slot) ──────────────
    const existing = this.clients.get(slotId);
    if (existing) {
      this.logger.warn(`slot ${slotId} 已有连接 · 踢老连接 · 接受新的`);
      try {
        existing.ws.close(1000, 'replaced by new connection');
      } catch {
        /* ignore */
      }
      this.clients.delete(slotId);
    }

    const conn: ClientConn = {
      ws,
      slotId,
      tenantId,
      connectedAt: Date.now(),
      lastHeartbeatAt: Date.now(),
      lastPageState: null,
    };
    this.clients.set(slotId, conn);
    this.logger.log(
      `runtime connected · slotId=${slotId} tenantId=${tenantId} · 当前 ${this.clients.size} 个 runtime 在线`,
    );

    // ─── wire events ────────────────────────────────
    ws.on('message', (data) => this.handleMessage(conn, data));
    ws.on('close', (code, reason) => this.handleClose(conn, code, reason?.toString() ?? ''));
    ws.on('error', (err) => {
      this.logger.warn(`runtime ${slotId} ws error: ${err.message}`);
    });

    // 通知业务: 该 slot 的 runtime 上线
    this.events.emit(eventName('runtime-online'), { slotId, tenantId, ts: Date.now() });
  }

  private handleMessage(conn: ClientConn, data: RawData): void {
    let parsed: RuntimeMessage;
    try {
      parsed = JSON.parse(data.toString()) as RuntimeMessage;
    } catch (err) {
      this.logger.warn(`slot ${conn.slotId} bad JSON: ${err instanceof Error ? err.message : err}`);
      return;
    }

    if (parsed.kind === 'ack') {
      const p = this.pending.get(parsed.requestId);
      if (!p) {
        // 可能已超时被清 · 忽略
        return;
      }
      this.pending.delete(parsed.requestId);
      p.resolve(parsed);
      return;
    }

    if (parsed.kind === 'event') {
      this.handleEvent(conn, parsed);
      return;
    }

    // cmd from runtime · 不该有 (反向)
    this.logger.warn(`slot ${conn.slotId} unexpected kind=${(parsed as { kind: string }).kind}`);
  }

  private handleEvent(conn: ClientConn, evt: RuntimeEvent): void {
    if (evt.type === 'heartbeat') {
      conn.lastHeartbeatAt = Date.now();
      conn.lastPageState = evt.pageState;
    }
    // 全部转发 EventEmitter2 · 业务模块订阅
    this.events.emit(eventName(evt.type), evt);
    // D8-1 · 全部 info 级 log 方便验桥 · D8-2 后再降 heartbeat 到 debug
    if (evt.type === 'heartbeat') {
      this.logger.log(
        `slot ${conn.slotId} heartbeat · pageState=${evt.pageState} uptimeMs=${evt.uptimeMs}`,
      );
    } else {
      this.logger.log(`slot ${conn.slotId} event=${evt.type} ts=${evt.ts}`);
    }
  }

  private handleClose(conn: ClientConn, code: number, reason: string): void {
    // 只在还是当前连接时清 (可能已经被 replace 踢出)
    if (this.clients.get(conn.slotId) === conn) {
      this.clients.delete(conn.slotId);
    }
    this.logger.log(
      `runtime disconnected · slotId=${conn.slotId} code=${code} reason="${reason}" · 剩 ${this.clients.size} 个`,
    );
    this.events.emit(eventName('runtime-offline'), {
      slotId: conn.slotId,
      tenantId: conn.tenantId,
      code,
      reason,
      ts: Date.now(),
    });
  }
}
