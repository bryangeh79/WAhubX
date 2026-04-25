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
  isJidBroadcast,
  isJidNewsletter,
  type WASocket,
  type GroupMetadata,
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
  SendReactCommand,
  ReadMessagesCommand,
  NewsletterMetadataCommand,
  NewsletterFollowCommand,
  GroupGetInviteInfoCommand,
  GroupAcceptInviteCommand,
  ProfilePictureUrlCommand,
  UpdateProfileStatusCommand,
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

// 2026-04-25 · P0#1 · worker 自管重连状态 (Phase 1 BaileysService.scheduleReconnect 等价)
// 父进程 facade 已经通过 OnEvent('baileys.worker.connection-close') 接事件 ·
// 但不再触发 reconnect (worker 自管). 父只用作日志 / status 维护.
let g_reconnectAttempts = 0;
let g_consecutive440 = 0;
let g_reconnectTimer: NodeJS.Timeout | null = null;
let g_stableTimer: NodeJS.Timeout | null = null;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_MS = 60_000; // 60 × 2^n × jitter(0.7-1.3)
const QUARANTINE_440_THRESHOLD = 2;
const STABLE_RESET_MS = 10_000;

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

// 2026-04-25 · Desktop 止血 · group metadata cache (Codex 拍板)
// 避免每次拉群成员触发 WA rate limit + 封号 · 社区报告"没实现 = 必踩坑"
// TTL 5 min · 简单 Map · 单 worker 进程内的 slot 用一份就行
const g_groupMetaCache = new Map<string, { meta: GroupMetadata; at: number }>();
const GROUP_META_TTL_MS = 5 * 60 * 1000;

function getCachedGroupMeta(jid: string): GroupMetadata | undefined {
  const e = g_groupMetaCache.get(jid);
  if (!e) return undefined;
  if (Date.now() - e.at > GROUP_META_TTL_MS) {
    g_groupMetaCache.delete(jid);
    return undefined;
  }
  return e.meta;
}

// 2026-04-25 · Desktop 止血 · shouldIgnoreJid (Codex 拍板)
// 跳 newsletter (channel) + status broadcast · 我们不订阅这些 · 不解密 · 省流量 + 减异常
function shouldIgnoreJid(jid: string): boolean {
  if (!jid) return false;
  if (isJidNewsletter(jid)) return true;
  if (isJidBroadcast(jid) && jid !== 'status@broadcast') {
    // status@broadcast 是 WA 状态频道 · 不忽略 (我们 sendReact 用得上)
    // 普通 broadcast list (xxxxxx@broadcast) 才忽略
    return true;
  }
  return false;
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
    // 2026-04-25 · Desktop 止血 · syncFullHistory 配套 callback (Codex 拍板)
    // Baileys 7.x 不带这 callback 会断 LID 映射 · 6.7 无此坑但加了无害
    // 我们一律拒绝 history 同步 · 客户消息只看实时 messages.upsert
    shouldSyncHistoryMessage: () => false,
    // 2026-04-25 · Desktop 止血 · group metadata cache (Codex 拍板)
    cachedGroupMetadata: async (jid) => getCachedGroupMeta(jid),
    // 2026-04-25 · Desktop 止血 · shouldIgnoreJid (Codex 拍板)
    shouldIgnoreJid,
    connectTimeoutMs: opts.connectTimeoutMs,
    keepAliveIntervalMs: opts.keepAliveIntervalMs,
    defaultQueryTimeoutMs: opts.defaultQueryTimeoutMs,
    emitOwnEvents: opts.emitOwnEvents,
    // 2026-04-25 · Desktop 止血 · markOnlineOnConnect 强制 false (Codex 拍板)
    // 原 fingerprint 里 50/50 随机 · 但 markOnlineOnConnect=true 会让手机停推送 +
    // 看上去像"机器人 24/7 在线" · 真人 WA Web 不是这模式. 强制 false.
    markOnlineOnConnect: false,
  });

  attachSocketListeners(sock);
  g_sock = sock;

  // 2026-04-25 · Desktop 止血 · 主动塞 groups.update 事件给 cache 保鲜
  // baileys 拉过的 group metadata 自动写入 cache · 下次 cachedGroupMetadata 命中
  sock.ev.on('groups.upsert', (groups) => {
    for (const g of groups) {
      g_groupMetaCache.set(g.id, { meta: g, at: Date.now() });
    }
  });
  sock.ev.on('groups.update', (updates) => {
    for (const u of updates) {
      if (u.id) {
        const existing = g_groupMetaCache.get(u.id);
        if (existing) {
          g_groupMetaCache.set(u.id, {
            meta: { ...existing.meta, ...u } as GroupMetadata,
            at: Date.now(),
          });
        }
      }
    }
  });

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
      // 10s 稳定 · 重置重连计数
      if (g_stableTimer) clearTimeout(g_stableTimer);
      g_stableTimer = setTimeout(() => {
        g_reconnectAttempts = 0;
        g_consecutive440 = 0;
        g_stableTimer = null;
      }, STABLE_RESET_MS);
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

      // 取消未启动的 stableTimer · close 没到 10s 计数不归零
      if (g_stableTimer) {
        clearTimeout(g_stableTimer);
        g_stableTimer = null;
      }

      emitEvent({ type: 'connection-close', code, reason });

      if (g_bindActive) {
        g_bindActive = false;
        emitEvent({ type: 'bind-state', state: 'failed', error: `连接关闭 (${reason})` });
        return;
      }

      // 2026-04-25 · P0#1 · worker 自管重连
      // 1. loggedOut · 不重连 · 父进程 markSlotSuspended
      if (code === DisconnectReason.loggedOut) {
        logLocal('warn', `logged out remotely · 不再重连 · 等父进程处理`);
        try {
          g_sock?.end(undefined);
        } catch {
          /* ignore */
        }
        g_sock = null;
        return;
      }

      // 2. connectionReplaced (440) · 累计 2 次进 quarantine
      if (code === DisconnectReason.connectionReplaced) {
        g_consecutive440 += 1;
        if (g_consecutive440 >= QUARANTINE_440_THRESHOLD) {
          logLocal('error', `连续 ${g_consecutive440} 次 440 · 不再重连 · 触发 fatal worker-error 让父 quarantine`);
          emitEvent({
            type: 'worker-error',
            error: `consecutive 440 · likely WA flagged this number`,
            fatal: true,
          });
          try {
            g_sock?.end(undefined);
          } catch {
            /* ignore */
          }
          g_sock = null;
          return;
        }
        logLocal('warn', `440 第 ${g_consecutive440} 次 · 仍重连`);
      }

      // 3. 普通 close · 指数退避 + jitter 重连
      if (g_reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        logLocal('error', `达到 ${MAX_RECONNECT_ATTEMPTS} 次重连上限 · 等父进程处理`);
        try {
          g_sock?.end(undefined);
        } catch {
          /* ignore */
        }
        g_sock = null;
        return;
      }

      const baseMs = RECONNECT_BASE_MS * Math.pow(2, g_reconnectAttempts);
      const jitter = 0.7 + Math.random() * 0.6;
      const delayMs = Math.round(baseMs * jitter);
      g_reconnectAttempts += 1;
      logLocal(
        'warn',
        `reconnect #${g_reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${Math.round(delayMs / 1000)}s (code=${code})`,
      );

      try {
        g_sock?.end(undefined);
      } catch {
        /* ignore */
      }
      g_sock = null;

      if (g_reconnectTimer) clearTimeout(g_reconnectTimer);
      g_reconnectTimer = setTimeout(() => {
        g_reconnectTimer = null;
        spawnSocket().catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          logLocal('error', `reconnect spawn failed: ${msg}`);
          // 失败后下一次 close 事件触发再重试
        });
      }, delayMs);
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
      case 'file':
        content = {
          document: buf,
          fileName: cmd.fileName ?? 'file.bin',
          mimetype: cmd.mimetype ?? 'application/octet-stream',
          caption: cmd.caption,
        };
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

async function handleSendReact(cmd: SendReactCommand): Promise<void> {
  if (!g_sock) {
    ack(cmd.requestId, false, undefined, 'socket not ready');
    return;
  }
  try {
    const sent = await g_sock.sendMessage(cmd.to, {
      react: { key: cmd.key as Parameters<WASocket['sendMessage']>[1] extends infer T ? T extends { react: { key: infer K } } ? K : never : never, text: cmd.emoji },
    } as Parameters<WASocket['sendMessage']>[1]);
    ack(cmd.requestId, true, { waMessageId: sent?.key?.id ?? null });
  } catch (err) {
    ack(cmd.requestId, false, undefined, err instanceof Error ? err.message : String(err));
  }
}

async function handleReadMessages(cmd: ReadMessagesCommand): Promise<void> {
  if (!g_sock) {
    ack(cmd.requestId, false, undefined, 'socket not ready');
    return;
  }
  try {
    await g_sock.readMessages(cmd.keys as Parameters<WASocket['readMessages']>[0]);
    ack(cmd.requestId, true);
  } catch (err) {
    ack(cmd.requestId, false, undefined, err instanceof Error ? err.message : String(err));
  }
}

async function handleGroupGetInviteInfo(cmd: GroupGetInviteInfoCommand): Promise<void> {
  if (!g_sock) {
    ack(cmd.requestId, false, undefined, 'socket not ready');
    return;
  }
  try {
    const meta = await g_sock.groupGetInviteInfo(cmd.inviteCode);
    ack(cmd.requestId, true, meta);
  } catch (err) {
    ack(cmd.requestId, false, undefined, err instanceof Error ? err.message : String(err));
  }
}

async function handleGroupAcceptInvite(cmd: GroupAcceptInviteCommand): Promise<void> {
  if (!g_sock) {
    ack(cmd.requestId, false, undefined, 'socket not ready');
    return;
  }
  try {
    const groupJid = await g_sock.groupAcceptInvite(cmd.inviteCode);
    ack(cmd.requestId, true, { groupJid });
  } catch (err) {
    ack(cmd.requestId, false, undefined, err instanceof Error ? err.message : String(err));
  }
}

async function handleProfilePictureUrl(cmd: ProfilePictureUrlCommand): Promise<void> {
  if (!g_sock) {
    ack(cmd.requestId, false, undefined, 'socket not ready');
    return;
  }
  try {
    const url = await g_sock.profilePictureUrl(cmd.jid, cmd.highRes ? 'image' : 'preview');
    ack(cmd.requestId, true, { url: url ?? null });
  } catch (err) {
    ack(cmd.requestId, false, undefined, err instanceof Error ? err.message : String(err));
  }
}

async function handleUpdateProfileStatus(cmd: UpdateProfileStatusCommand): Promise<void> {
  if (!g_sock) {
    ack(cmd.requestId, false, undefined, 'socket not ready');
    return;
  }
  try {
    await g_sock.updateProfileStatus(cmd.status);
    ack(cmd.requestId, true);
  } catch (err) {
    ack(cmd.requestId, false, undefined, err instanceof Error ? err.message : String(err));
  }
}

async function handleNewsletterMetadata(cmd: NewsletterMetadataCommand): Promise<void> {
  if (!g_sock) {
    ack(cmd.requestId, false, undefined, 'socket not ready');
    return;
  }
  try {
    const s = g_sock as unknown as {
      newsletterMetadata: (lookupBy: string, key: string) => Promise<unknown>;
    };
    const meta = await s.newsletterMetadata(cmd.lookupBy, cmd.key);
    ack(cmd.requestId, true, meta ?? null);
  } catch (err) {
    ack(cmd.requestId, false, undefined, err instanceof Error ? err.message : String(err));
  }
}

async function handleNewsletterFollow(cmd: NewsletterFollowCommand): Promise<void> {
  if (!g_sock) {
    ack(cmd.requestId, false, undefined, 'socket not ready');
    return;
  }
  try {
    const s = g_sock as unknown as {
      newsletterFollow: (jid: string) => Promise<unknown>;
    };
    const result = await s.newsletterFollow(cmd.jid);
    ack(cmd.requestId, true, result ?? null);
  } catch (err) {
    ack(cmd.requestId, false, undefined, err instanceof Error ? err.message : String(err));
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
  if (g_reconnectTimer) clearTimeout(g_reconnectTimer);
  if (g_stableTimer) clearTimeout(g_stableTimer);
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
  if (g_reconnectTimer) clearTimeout(g_reconnectTimer);
  if (g_stableTimer) clearTimeout(g_stableTimer);
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
    case 'send-react':
      void handleSendReact(cmd);
      break;
    case 'read-messages':
      void handleReadMessages(cmd);
      break;
    case 'newsletter-metadata':
      void handleNewsletterMetadata(cmd);
      break;
    case 'newsletter-follow':
      void handleNewsletterFollow(cmd);
      break;
    case 'group-get-invite-info':
      void handleGroupGetInviteInfo(cmd);
      break;
    case 'group-accept-invite':
      void handleGroupAcceptInvite(cmd);
      break;
    case 'profile-picture-url':
      void handleProfilePictureUrl(cmd);
      break;
    case 'update-profile-status':
      void handleUpdateProfileStatus(cmd);
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
