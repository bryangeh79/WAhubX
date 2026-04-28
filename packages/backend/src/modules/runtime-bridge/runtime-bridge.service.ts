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
} from '@wahubx/shared';

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

// 2026-04-25 · D8-2 · per-slot bind 状态缓存 (Codex 拍板)
// UI 拉这个就能渲 · 不用每次去问 runtime
//
// 语义边界 (D8-3 · Codex 锁定):
//   bindState = bind session 状态 (idle 表示一轮结束)
//   不等于 page 物理状态 · UI 取这个判断 "扫码进度"
//   page 物理状态从 heartbeat.pageState 单独读 · 仅诊断用
export interface BindStateCache {
  slotId: number;
  tenantId: number;
  /** runtime fsm 状态 (idle/starting/qr/connecting/connected/timeout/cancelled/failed) */
  bindState: string;
  /** 最后一张 QR · base64 data URL · qr 状态时有 */
  qrDataUrl: string | null;
  qrRefreshCount: number;
  /** 命中 chat-list 时的 selector */
  chatListSelector: string | null;
  /** 任意失败的 error message */
  error: string | null;
  /** 任何事件最后到达时间 · UI 看 staleness */
  lastEventAt: number;
  /** start-bind 收到的时间 · idle 时为 0 */
  sessionStartedAt: number;
  /** connected 时间 · 未到为 0 */
  connectedAt: number;
  // 2026-04-25 · D8-3 · 最后一次 connection-close 详情 (Codex 锁定 · 区分原因)
  /** page-closed | browser-disconnected | wa-logged-out | runtime-fatal | null */
  lastDisconnectCategory: string | null;
  lastDisconnectReason: string | null;
  lastDisconnectAt: number;
}

@Injectable()
export class RuntimeBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RuntimeBridgeService.name);
  private wss: WebSocketServer | null = null;
  private httpServer: http.Server | null = null;
  private readonly clients = new Map<number, ClientConn>();
  private readonly pending = new Map<string, PendingRequest>();
  // D8-2 · per-slotId bind 状态缓存
  private readonly bindStates = new Map<number, BindStateCache>();

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
   * D8-2 · 公共方法 · 触发 runtime 开始 bind 流程
   */
  async startBind(slotId: number, pairingPhoneNumber?: string): Promise<{ state: string }> {
    const cmd = (pairingPhoneNumber
      ? { kind: 'cmd', type: 'start-bind', pairingPhoneNumber }
      : { kind: 'cmd', type: 'start-bind' }) as Omit<RuntimeCommand, 'requestId'>;
    return this.sendCommand<{ state: string }>(slotId, cmd);
  }

  /**
   * D8-2 · 公共方法 · 取消 runtime bind 流程
   */
  async cancelBind(slotId: number): Promise<{ wasInState: string }> {
    return this.sendCommand<{ wasInState: string }>(slotId, { kind: 'cmd', type: 'cancel-bind' });
  }

  /**
   * D8-2 · 公共方法 · 拉 runtime 当前 fsm 状态
   */
  async fetchStatus(slotId: number): Promise<{ state: string; sessionStartedAt: number; pageState: string }> {
    return this.sendCommand(slotId, { kind: 'cmd', type: 'fetch-status' });
  }

  /**
   * D8-2 · 拉 backend 缓存的 bind 状态 (UI 主用)
   * 不打 runtime · 直接返本地缓存 · O(1)
   */
  getCachedBindState(slotId: number): BindStateCache | null {
    return this.bindStates.get(slotId) ?? null;
  }

  /**
   * 2026-04-28 · 清缓存的 bind 状态 (clear 触发 · 恢复出厂)
   */
  clearCachedBindState(slotId: number): void {
    this.bindStates.delete(slotId);
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

    // D8-2 · 更新 per-slot bind 缓存 (Codex 拍板 · 缓存按 slotId 独立)
    this.updateBindStateCache(conn, evt);

    // 全部转发 EventEmitter2 · 业务模块订阅
    this.events.emit(eventName(evt.type), evt);

    // D8-2 · log 策略: heartbeat 频率高 · 改 debug · 其他 info
    if (evt.type === 'heartbeat') {
      this.logger.debug?.(
        `slot ${conn.slotId} heartbeat · pageState=${evt.pageState} uptimeMs=${evt.uptimeMs}`,
      );
    } else {
      this.logger.log(`slot ${conn.slotId} event=${evt.type} ts=${evt.ts}`);
    }
  }

  /**
   * D8-2 · 把 runtime event 投影到 per-slot 缓存 · UI 直接读这个
   * D8-3 · 加 connection-close 分类 + bindState/pageState 语义边界
   */
  private updateBindStateCache(conn: ClientConn, evt: RuntimeEvent): void {
    let cache = this.bindStates.get(conn.slotId);
    if (!cache) {
      cache = {
        slotId: conn.slotId,
        tenantId: conn.tenantId,
        bindState: 'idle',
        qrDataUrl: null,
        qrRefreshCount: 0,
        chatListSelector: null,
        error: null,
        lastEventAt: 0,
        sessionStartedAt: 0,
        connectedAt: 0,
        lastDisconnectCategory: null,
        lastDisconnectReason: null,
        lastDisconnectAt: 0,
      };
      this.bindStates.set(conn.slotId, cache);
    }
    cache.lastEventAt = evt.ts;

    switch (evt.type) {
      case 'bind-state':
        cache.bindState = evt.state;
        if (evt.error) cache.error = evt.error;
        if (evt.state === 'starting') {
          // 一轮新开 · 清旧
          cache.sessionStartedAt = evt.ts;
          cache.error = null;
          cache.qrDataUrl = null;
          cache.qrRefreshCount = 0;
          cache.chatListSelector = null;
          cache.connectedAt = 0;
          // disconnect 信息保留 · 这样 UI 仍能看 "上次为何失败"
        }
        if (evt.state === 'connected') {
          cache.connectedAt = evt.ts;
          // 成功连上 · 清 disconnect 历史 (这次干净了)
          cache.lastDisconnectCategory = null;
          cache.lastDisconnectReason = null;
          cache.lastDisconnectAt = 0;
        }
        break;
      case 'qr':
        cache.qrDataUrl = evt.dataUrl;
        cache.qrRefreshCount = evt.qrRefreshCount;
        break;
      case 'connection-open':
        cache.chatListSelector = evt.selector;
        break;
      case 'connection-close':
        // D8-3 · 不直接覆盖 bindState · runtime 端会通过 bind-state event 显式切到 failed/idle
        // 这里只记录 disconnect 详情 · UI 看 lastDisconnect* 知道为什么断
        cache.lastDisconnectCategory = evt.category;
        cache.lastDisconnectReason = evt.reason;
        cache.lastDisconnectAt = evt.ts;
        // 已 connected 的 session 被 close = 算非自愿断 · bindState 翻 failed
        // (runtime 端 fsm 不一定能跑到 emitBindState · 比如 page 突然 close)
        if (cache.bindState === 'connected') {
          cache.bindState = 'failed';
          cache.error = `connection lost: ${evt.category}`;
          cache.connectedAt = 0;
        }
        break;
      // heartbeat / message-upsert / runtime-log / runtime-error 不动 bind 缓存
      // (runtime-error 单独转 EventEmitter2 给业务 · 不污染 bindState)
      default:
        break;
    }
  }

  private handleClose(conn: ClientConn, code: number, reason: string): void {
    // 只在还是当前连接时清 (可能已经被 replace 踢出)
    if (this.clients.get(conn.slotId) === conn) {
      this.clients.delete(conn.slotId);
      // D8-2 · runtime 断 · 缓存的 bindState 标 idle (不删 · 保留最后一次 sessionStartedAt 等)
      const cache = this.bindStates.get(conn.slotId);
      if (cache && cache.bindState !== 'connected') {
        // 跑 bind 中断 · 算 failed
        cache.bindState = 'failed';
        cache.error = `runtime disconnected · code=${code} reason=${reason}`;
        cache.lastEventAt = Date.now();
      }
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
