// 2026-04-25 · Phase 2 · Baileys Worker IPC 协议
//
// 架构: 父进程 BaileysService 为 orchestrator · 每 slot 一个独立 Node 子进程
// 通讯: Node.js child_process.fork() + process.send() / process.on('message')
//
// 设计原则:
//   - 命令 (Parent → Worker) 带 requestId · Worker 收到后执行再 ACK
//   - 事件 (Worker → Parent) 不带 requestId · 主动推送 (messages.upsert / connection.update / etc)
//   - 所有数据 JSON 可序列化 (Buffer 要 base64)
//   - 超时: 命令默认 30s 无 ACK 视为失败

// ═══ 命令: Parent → Worker ════════════════════════════════════════════

export type WorkerCommandType =
  | 'init'                  // 初始化配置 (slotId / slotIndex / tenantId / sessionDir / fingerprint / proxy)
  | 'start-bind'            // 开始扫 QR 或 pair code
  | 'cancel-bind'           // 取消 bind
  | 'rehydrate'             // 从磁盘 session 起常驻 socket
  | 'send-text'             // 发文本
  | 'send-media'            // 发媒体 (image/video/voice)
  | 'send-presence'         // composing / recording / paused / available
  | 'newsletter-metadata'   // 查频道 metadata (invite code 或 jid)
  | 'newsletter-follow'     // follow 频道
  | 'fetch-status'          // 查当前 socket 状态
  | 'shutdown'              // 优雅关闭 (save creds + close socket)
  | 'force-evict';          // 强制踢 socket (不存 creds)

export interface WorkerCommandBase {
  type: WorkerCommandType;
  requestId: string; // 父进程生成 uuid · Worker ACK 时回填
}

export interface InitCommand extends WorkerCommandBase {
  type: 'init';
  slotId: number;
  slotIndex: number;
  tenantId: number;
  sessionDir: string;
  // fingerprint 从父进程读磁盘后传给 worker · worker 不重复读 (避免竞态)
  fingerprint: {
    baileysBrowser: [string, string, string];
    baileysOpts: {
      connectTimeoutMs: number;
      keepAliveIntervalMs: number;
      defaultQueryTimeoutMs: number;
      emitOwnEvents: boolean;
      markOnlineOnConnect: boolean;
    };
    userAgent: string;
  };
  // 代理配置 · null 表示直连
  proxy: {
    type: 'http' | 'socks';
    host: string;
    port: number;
    username?: string;
    password?: string;
  } | null;
  waVersion: [number, number, number];
}

export interface StartBindCommand extends WorkerCommandBase {
  type: 'start-bind';
  pairingPhoneNumber?: string; // 给定则走 pair code · 否则 QR
}

export interface CancelBindCommand extends WorkerCommandBase {
  type: 'cancel-bind';
}

export interface RehydrateCommand extends WorkerCommandBase {
  type: 'rehydrate';
}

export interface SendTextCommand extends WorkerCommandBase {
  type: 'send-text';
  to: string;      // phone E.164 或 JID
  text: string;
  quotedMessageId?: string;
}

export interface SendMediaCommand extends WorkerCommandBase {
  type: 'send-media';
  to: string;
  mediaType: 'image' | 'video' | 'voice' | 'audio';
  // 父进程把文件读成 base64 · worker 解码后发 (避免 worker 访问父进程磁盘路径可能不一致)
  mediaBase64: string;
  mimetype?: string;
  caption?: string;
  ptt?: boolean; // 仅 voice 用 · true = 语音消息
}

export interface SendPresenceCommand extends WorkerCommandBase {
  type: 'send-presence';
  to: string;
  presence: 'composing' | 'recording' | 'paused' | 'available' | 'unavailable';
}

export interface NewsletterMetadataCommand extends WorkerCommandBase {
  type: 'newsletter-metadata';
  lookupBy: 'invite' | 'jid';
  key: string;
}

export interface NewsletterFollowCommand extends WorkerCommandBase {
  type: 'newsletter-follow';
  jid: string;
}

export interface FetchStatusCommand extends WorkerCommandBase {
  type: 'fetch-status';
}

export interface ShutdownCommand extends WorkerCommandBase {
  type: 'shutdown';
}

export interface ForceEvictCommand extends WorkerCommandBase {
  type: 'force-evict';
}

export type WorkerCommand =
  | InitCommand
  | StartBindCommand
  | CancelBindCommand
  | RehydrateCommand
  | SendTextCommand
  | SendMediaCommand
  | SendPresenceCommand
  | NewsletterMetadataCommand
  | NewsletterFollowCommand
  | FetchStatusCommand
  | ShutdownCommand
  | ForceEvictCommand;

// ═══ 命令 ACK: Worker → Parent ════════════════════════════════════════

export interface WorkerCommandAck {
  kind: 'ack';
  requestId: string;
  ok: boolean;
  error?: string;
  // 各命令的返回数据 (send-text 返 messageId 等)
  data?: unknown;
}

// ═══ 事件: Worker → Parent ════════════════════════════════════════════

export type WorkerEventType =
  | 'qr'                   // 新 QR 生成 (bind 流程)
  | 'pairing-code'         // pair code 生成
  | 'bind-state'           // bind 状态变化 (connecting / connected / failed / etc)
  | 'connection-open'      // pool socket 连通
  | 'connection-close'     // pool socket 断开 + close code
  | 'creds-updated'        // creds 变化 (父不需要 · worker 自己落盘)
  | 'message-upsert'       // 收到消息
  | 'status-upsert'        // 收到状态更新
  | 'heartbeat'            // 主动心跳 (worker 每 30s 发一条 · 父确认 worker 活)
  | 'worker-error'         // worker 内部异常 · 父可选 respawn
  | 'worker-log';          // worker 日志转发给父 · 父统一打 pino

export interface WorkerEventBase {
  kind: 'event';
  type: WorkerEventType;
  slotId: number; // 父收到后可据此路由
  ts: number;     // Date.now()
}

export interface QrEvent extends WorkerEventBase {
  type: 'qr';
  qr: string; // raw QR string · 父转 dataURL
}

export interface PairingCodeEvent extends WorkerEventBase {
  type: 'pairing-code';
  code: string;
}

export interface BindStateEvent extends WorkerEventBase {
  type: 'bind-state';
  state: 'starting' | 'qr' | 'connecting' | 'connected' | 'failed' | 'cancelled' | 'timeout';
  error?: string;
  phoneNumber?: string;
}

export interface ConnectionOpenEvent extends WorkerEventBase {
  type: 'connection-open';
  userId?: string; // sock.user?.id
}

export interface ConnectionCloseEvent extends WorkerEventBase {
  type: 'connection-close';
  code: number; // DisconnectReason
  reason: string;
}

export interface CredsUpdatedEvent extends WorkerEventBase {
  type: 'creds-updated';
}

export interface MessageUpsertEvent extends WorkerEventBase {
  type: 'message-upsert';
  upsertType: 'notify' | 'append'; // baileys messages.upsert evt.type
  // 整条 msg 原封传 · 父负责入 chat_message 表 + 触发 takeover 事件
  messages: unknown[]; // baileys WAMessage[] · 保持 unknown 避免跨边界 import
}

export interface StatusUpsertEvent extends WorkerEventBase {
  type: 'status-upsert';
  messages: unknown[];
}

export interface HeartbeatEvent extends WorkerEventBase {
  type: 'heartbeat';
  wsOpen: boolean; // sock.ws.readyState === 1
}

export interface WorkerErrorEvent extends WorkerEventBase {
  type: 'worker-error';
  error: string;
  fatal: boolean; // 父是否应 respawn
}

export interface WorkerLogEvent extends WorkerEventBase {
  type: 'worker-log';
  level: 'info' | 'warn' | 'error';
  message: string;
}

export type WorkerEvent =
  | QrEvent
  | PairingCodeEvent
  | BindStateEvent
  | ConnectionOpenEvent
  | ConnectionCloseEvent
  | CredsUpdatedEvent
  | MessageUpsertEvent
  | StatusUpsertEvent
  | HeartbeatEvent
  | WorkerErrorEvent
  | WorkerLogEvent;

// ═══ 父 ↔ 子 统一消息类型 ════════════════════════════════════════════

export type WorkerMessage = WorkerCommand | WorkerCommandAck | WorkerEvent;

// ═══ 常量 ════════════════════════════════════════════════════════════

export const WORKER_IPC_TIMEOUT_MS = 30_000;       // 命令默认 ACK 超时
export const WORKER_HEARTBEAT_INTERVAL_MS = 30_000; // worker 主动发心跳
export const WORKER_RESPAWN_DELAY_MS = 5_000;       // 崩溃后 respawn 前等待
export const WORKER_MAX_RESPAWN_24H = 3;            // 24h 内崩 3 次则 quarantine
