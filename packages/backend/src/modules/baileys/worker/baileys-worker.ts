// 2026-04-25 · Phase 2 · Baileys Worker 子进程 entry point
//
// 这是独立 Node 子进程 · 通过 process.send() / process.on('message') 跟父进程 IPC 通讯.
// 每个 slot 跑一个 worker · WA socket 常驻进程内 · 父进程崩溃不影响 worker · worker 崩溃
// 父进程 auto-respawn.
//
// 职责 (MVP 阶段):
//   - init: 用接收的配置建 WASocket + useMultiFileAuthState
//   - heartbeat: 每 30s 主动发一条 · 让父进程知道 worker 活
//   - send-text: 通过 sock.sendMessage 发消息
//   - shutdown: 优雅关闭 · save creds + sock.end()
//   - messages.upsert → message-upsert event
//   - connection.update → connection-open/close event
//   - creds.update → 自己落盘 (worker 独占 session 目录)
//
// 待实现 (后续阶段):
//   - start-bind / cancel-bind (QR + pair code)
//   - send-media (image/video/voice)
//   - send-presence
//   - force-evict
//
// 启动方式 (parent fork 时): node dist/modules/baileys/worker/baileys-worker.js
//
// 2026-04-25 首版: 简化优先 · 稳定性能确认后再加复杂路径

import {
  default as makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import type {
  WorkerCommand,
  WorkerCommandAck,
  WorkerEvent,
  InitCommand,
  StartBindCommand,
  SendTextCommand,
  SendMediaCommand,
  SendPresenceCommand,
} from './worker-protocol';
import { WORKER_HEARTBEAT_INTERVAL_MS } from './worker-protocol';
import { buildProxyAgent, type ProxyDescriptor } from '../../../common/proxy-config';

// ═══ 模块级状态 ═══════════════════════════════════════════════════════
// 每个 worker 进程只服务一个 slot · 全局单例足够

let g_slotId = -1;
let g_config: InitCommand | null = null; // init 后存 · 后续 spawn 都用这份
let g_sock: WASocket | null = null;
let g_saveCreds: (() => Promise<void>) | null = null;
let g_heartbeatTimer: NodeJS.Timeout | null = null;
let g_shuttingDown = false;
// bind 状态 · 只在 start-bind 期间活
let g_bindActive = false;
let g_bindMode: 'qr' | 'pair' = 'qr';
let g_bindPairingPhone: string | undefined = undefined;
let g_bindPairRequested = false;

// worker 内部 logger · 通过 process.send 转发 · 父进程统一打 pino
const logLocal = (level: 'info' | 'warn' | 'error', message: string): void => {
  send({
    kind: 'event',
    type: 'worker-log',
    slotId: g_slotId,
    ts: Date.now(),
    level,
    message,
  });
};

// ═══ IPC 封装 ════════════════════════════════════════════════════════

function send(msg: WorkerCommandAck | WorkerEvent): void {
  if (!process.send) {
    // standalone 启动 (调试用) · 走 stdout
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(msg));
    return;
  }
  try {
    process.send(msg);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[worker] process.send failed:', err);
  }
}

function ack(requestId: string, ok: boolean, data?: unknown, error?: string): void {
  send({ kind: 'ack', requestId, ok, error, data });
}

// TS 泛型对 union type 的 Omit 推不过来 · 用 any 包一下 · 类型在协议文件已定
// 保证发出去的是合法 WorkerEvent
function emitEvent(evt: { type: WorkerEvent['type']; [k: string]: unknown }): void {
  send({
    kind: 'event',
    slotId: g_slotId,
    ts: Date.now(),
    ...evt,
  } as unknown as WorkerEvent);
}

// ═══ 命令处理 ═════════════════════════════════════════════════════════

async function handleInit(cmd: InitCommand): Promise<void> {
  if (g_config) {
    ack(cmd.requestId, false, undefined, 'worker already initialized');
    return;
  }
  g_slotId = cmd.slotId;
  g_config = cmd;
  startHeartbeat();
  logLocal('info', `worker initialized for slot ${cmd.slotId} (index ${cmd.slotIndex})`);
  ack(cmd.requestId, true);
}

// 统一创建 socket · bind 和 rehydrate 都走这里
// rebind=true 表示这是 QR 流中的 515 重启 spawn · 保持原 auth state
async function spawnSocket(): Promise<WASocket> {
  if (!g_config) throw new Error('not initialized');
  const cmd = g_config;
  const { state, saveCreds } = await useMultiFileAuthState(cmd.sessionDir);
  g_saveCreds = saveCreds;

  const proxyAgent = cmd.proxy ? buildProxyAgent(cmd.proxy as ProxyDescriptor) : null;

  const opts = cmd.fingerprint.baileysOpts;
  const sock = makeWASocket({
    version: cmd.waVersion,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'warn' }) as unknown as ReturnType<typeof pino>,
    browser: cmd.fingerprint.baileysBrowser,
    agent: (proxyAgent ?? undefined) as never,
    fetchAgent: (proxyAgent ?? undefined) as never,
    syncFullHistory: false,
    connectTimeoutMs: opts.connectTimeoutMs,
    keepAliveIntervalMs: opts.keepAliveIntervalMs,
    defaultQueryTimeoutMs: opts.defaultQueryTimeoutMs,
    emitOwnEvents: opts.emitOwnEvents,
    markOnlineOnConnect: opts.markOnlineOnConnect,
  });

  attachSocketListeners(sock);
  g_sock = sock;
  return sock;
}

async function handleRehydrate(requestId: string): Promise<void> {
  if (!g_config) {
    ack(requestId, false, undefined, 'not initialized');
    return;
  }
  if (g_sock) {
    ack(requestId, false, undefined, 'socket already exists');
    return;
  }
  try {
    await spawnSocket();
    ack(requestId, true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logLocal('error', `rehydrate failed: ${msg}`);
    ack(requestId, false, undefined, msg);
  }
}

async function handleStartBind(cmd: StartBindCommand): Promise<void> {
  if (!g_config) {
    ack(cmd.requestId, false, undefined, 'not initialized');
    return;
  }
  if (g_sock) {
    ack(cmd.requestId, false, undefined, 'socket already exists · cancel first');
    return;
  }
  g_bindActive = true;
  g_bindMode = cmd.pairingPhoneNumber ? 'pair' : 'qr';
  g_bindPairingPhone = cmd.pairingPhoneNumber;
  g_bindPairRequested = false;
  try {
    await spawnSocket();
    emitEvent({ type: 'bind-state', state: 'starting' });
    ack(cmd.requestId, true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logLocal('error', `start-bind failed: ${msg}`);
    g_bindActive = false;
    ack(cmd.requestId, false, undefined, msg);
  }
}

async function handleCancelBind(requestId: string): Promise<void> {
  if (!g_bindActive) {
    ack(requestId, true);
    return;
  }
  g_bindActive = false;
  try {
    g_sock?.end(undefined);
  } catch {
    /* ignore */
  }
  g_sock = null;
  emitEvent({ type: 'bind-state', state: 'cancelled' });
  ack(requestId, true);
}

function attachSocketListeners(sock: WASocket): void {
  sock.ev.on('creds.update', async () => {
    try {
      await g_saveCreds?.();
      emitEvent({ type: 'creds-updated' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logLocal('error', `saveCreds failed: ${msg}`);
    }
  });

  sock.ev.on('connection.update', (update) => {
    const { connection, qr, lastDisconnect } = update;

    // bind 流: QR 事件
    if (qr && g_bindActive) {
      if (g_bindMode === 'qr') {
        emitEvent({ type: 'qr', qr });
        emitEvent({ type: 'bind-state', state: 'qr' });
      } else if (g_bindMode === 'pair' && !g_bindPairRequested && g_bindPairingPhone) {
        g_bindPairRequested = true;
        void requestPairingCode(sock, g_bindPairingPhone);
      }
    }

    if (connection === 'connecting') {
      if (g_bindActive) emitEvent({ type: 'bind-state', state: 'connecting' });
    }

    if (connection === 'open') {
      const userId = sock.user?.id ?? undefined;
      emitEvent({ type: 'connection-open', userId });
      if (g_bindActive) {
        g_bindActive = false;
        emitEvent({
          type: 'bind-state',
          state: 'connected',
          phoneNumber: userId?.split(':')[0].split('@')[0],
        });
      }
    }

    if (connection === 'close') {
      const code =
        lastDisconnect?.error instanceof Boom
          ? (lastDisconnect.error as Boom).output.statusCode
          : 0;
      const reason =
        Object.entries(DisconnectReason).find(([, v]) => v === code)?.[0] ?? 'unknown';

      // 515 restartRequired: 扫码成功 WA 要求重开 socket · worker 自动处理
      if (code === DisconnectReason.restartRequired && g_bindActive) {
        logLocal('info', `restart required · respawning socket with registered creds`);
        try {
          g_sock?.end(undefined);
        } catch {
          /* ignore */
        }
        g_sock = null;
        g_bindPairRequested = false; // pair 码只首次需要 · 重启不再请求
        void spawnSocket().catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          logLocal('error', `restart respawn failed: ${msg}`);
          g_bindActive = false;
          emitEvent({ type: 'bind-state', state: 'failed', error: msg });
        });
        return;
      }

      emitEvent({ type: 'connection-close', code, reason });
      if (g_bindActive) {
        g_bindActive = false;
        emitEvent({ type: 'bind-state', state: 'failed', error: `连接关闭 (${reason})` });
      }
    }
  });

  sock.ev.on('messages.upsert', (evt) => {
    // 整条 raw msg 转发给父 · 父负责落 DB (复用现有 persistIncomingMessage)
    emitEvent({
      type: 'message-upsert',
      upsertType: evt.type,
      messages: evt.messages as unknown[],
    });
  });
}

async function requestPairingCode(sock: WASocket, phone: string): Promise<void> {
  try {
    // baileys requestPairingCode 需等 socket noise handshake 完成 · qr 事件是标志
    const code = await sock.requestPairingCode(phone);
    const formatted = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
    emitEvent({ type: 'pairing-code', code: formatted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logLocal('error', `requestPairingCode failed: ${msg}`);
    emitEvent({ type: 'bind-state', state: 'failed', error: `配对码请求失败 (${msg})` });
  }
}

async function handleSendText(cmd: SendTextCommand): Promise<void> {
  if (!g_sock) {
    ack(cmd.requestId, false, undefined, 'socket not ready');
    return;
  }
  try {
    const jid = cmd.to.includes('@') ? cmd.to : `${cmd.to}@s.whatsapp.net`;
    const sent = await g_sock.sendMessage(jid, { text: cmd.text });
    ack(cmd.requestId, true, {
      waMessageId: sent?.key?.id ?? null,
      to: jid,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ack(cmd.requestId, false, undefined, msg);
  }
}

async function handleSendMedia(cmd: SendMediaCommand): Promise<void> {
  if (!g_sock) {
    ack(cmd.requestId, false, undefined, 'socket not ready');
    return;
  }
  try {
    const jid = cmd.to.includes('@') ? cmd.to : `${cmd.to}@s.whatsapp.net`;
    const buf = Buffer.from(cmd.mediaBase64, 'base64');
    let content: Record<string, unknown>;
    switch (cmd.mediaType) {
      case 'image':
        content = { image: buf, caption: cmd.caption, mimetype: cmd.mimetype };
        break;
      case 'video':
        content = { video: buf, caption: cmd.caption, mimetype: cmd.mimetype };
        break;
      case 'voice':
      case 'audio':
        content = { audio: buf, mimetype: cmd.mimetype ?? 'audio/ogg; codecs=opus', ptt: cmd.ptt ?? cmd.mediaType === 'voice' };
        break;
      default:
        ack(cmd.requestId, false, undefined, `unsupported media type: ${String(cmd.mediaType)}`);
        return;
    }
    const sent = await g_sock.sendMessage(jid, content as Parameters<WASocket['sendMessage']>[1]);
    ack(cmd.requestId, true, {
      waMessageId: sent?.key?.id ?? null,
      to: jid,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ack(cmd.requestId, false, undefined, msg);
  }
}

async function handleSendPresence(cmd: SendPresenceCommand): Promise<void> {
  if (!g_sock) {
    ack(cmd.requestId, false, undefined, 'socket not ready');
    return;
  }
  try {
    const jid = cmd.to.includes('@') ? cmd.to : `${cmd.to}@s.whatsapp.net`;
    await g_sock.sendPresenceUpdate(cmd.presence, jid);
    ack(cmd.requestId, true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ack(cmd.requestId, false, undefined, msg);
  }
}

async function handleShutdown(requestId: string): Promise<void> {
  g_shuttingDown = true;
  if (g_heartbeatTimer) clearInterval(g_heartbeatTimer);
  try {
    // 保存 creds 再关
    await g_saveCreds?.();
    try {
      g_sock?.end(undefined);
    } catch {
      /* ignore */
    }
    ack(requestId, true);
    // 让 ACK 有机会发出去
    setTimeout(() => process.exit(0), 200);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ack(requestId, false, undefined, msg);
    setTimeout(() => process.exit(1), 200);
  }
}

function handleForceEvict(requestId: string): void {
  g_shuttingDown = true;
  if (g_heartbeatTimer) clearInterval(g_heartbeatTimer);
  try {
    g_sock?.end(undefined);
  } catch {
    /* ignore */
  }
  ack(requestId, true);
  setTimeout(() => process.exit(0), 100);
}

function handleFetchStatus(requestId: string): void {
  const ws = (g_sock as unknown as { ws?: { readyState?: number } })?.ws;
  ack(requestId, true, {
    initialized: g_config !== null,
    hasSocket: g_sock !== null,
    wsOpen: ws?.readyState === 1,
    userId: g_sock?.user?.id ?? null,
    bindActive: g_bindActive,
  });
}

// ═══ 心跳 ════════════════════════════════════════════════════════════

function startHeartbeat(): void {
  if (g_heartbeatTimer) clearInterval(g_heartbeatTimer);
  g_heartbeatTimer = setInterval(() => {
    if (g_shuttingDown) return;
    const ws = (g_sock as unknown as { ws?: { readyState?: number } })?.ws;
    emitEvent({ type: 'heartbeat', wsOpen: ws?.readyState === 1 });
  }, WORKER_HEARTBEAT_INTERVAL_MS);
}

// ═══ 消息路由 ═════════════════════════════════════════════════════════

process.on('message', (msg: unknown) => {
  const cmd = msg as WorkerCommand;
  if (!cmd || typeof cmd !== 'object' || !('type' in cmd) || !('requestId' in cmd)) {
    return;
  }
  switch (cmd.type) {
    case 'init':
      void handleInit(cmd);
      break;
    case 'rehydrate':
      void handleRehydrate(cmd.requestId);
      break;
    case 'start-bind':
      void handleStartBind(cmd);
      break;
    case 'cancel-bind':
      void handleCancelBind(cmd.requestId);
      break;
    case 'send-text':
      void handleSendText(cmd);
      break;
    case 'send-media':
      void handleSendMedia(cmd);
      break;
    case 'send-presence':
      void handleSendPresence(cmd);
      break;
    case 'shutdown':
      void handleShutdown(cmd.requestId);
      break;
    case 'force-evict':
      handleForceEvict(cmd.requestId);
      break;
    case 'fetch-status':
      handleFetchStatus(cmd.requestId);
      break;
    default: {
      // 穷举保护 · 若未来加了新 command 类型这里会 TS 错 · 提醒补 case
      const exhaustive = cmd as WorkerCommand;
      ack(
        exhaustive.requestId,
        false,
        undefined,
        `command type "${exhaustive.type}" not implemented`,
      );
    }
  }
});

// ═══ 防崩 ════════════════════════════════════════════════════════════

process.on('uncaughtException', (err) => {
  logLocal('error', `uncaughtException: ${err.message}\n${err.stack ?? ''}`);
  emitEvent({ type: 'worker-error', error: err.message, fatal: true });
  // 不自动退出 · 让父进程决定是否 kill
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  logLocal('error', `unhandledRejection: ${msg}`);
  emitEvent({ type: 'worker-error', error: msg, fatal: false });
});

process.on('SIGTERM', () => {
  if (!g_shuttingDown) {
    void handleShutdown('sigterm-auto');
  }
});

process.on('SIGINT', () => {
  if (!g_shuttingDown) {
    void handleShutdown('sigint-auto');
  }
});

logLocal('info', 'baileys worker booted · waiting for init command');
