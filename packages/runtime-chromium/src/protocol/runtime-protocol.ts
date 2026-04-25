// 2026-04-25 · D8-1 · Runtime ↔ Backend WS 协议 (lean 版 · subset of worker-protocol)
//
// 形态对齐 packages/backend/src/modules/baileys/worker/worker-protocol.ts ·
// 但只含 Chromium 路线需要的命令/事件 · 不含 baileys 特有 (send-react/newsletter/group/etc)
//
// D14+ 重构到 packages/shared/ 真正共享.
//
// 序列化: 全部走 JSON (不走 process.send 的对象 IPC).
//   - kind: 'cmd' | 'ack' | 'event'
//   - 命令 / ACK 用 requestId 关联
//   - 事件单向推 · 不带 requestId
//
// 2026-04-25 · D8-3 · 语义边界 (Codex 锁定):
//
//   bindState (BindStateEvent.state) — runtime 当前一轮 bind session 的逻辑状态
//     · idle: 没在跑 bind (默认 / 一轮结束后)
//     · starting / qr / connecting / connected: 一轮中
//     · timeout / cancelled / failed: 一轮终态 · 即将 reset 回 idle
//
//   pageState (HeartbeatEvent.pageState) — Chromium 页面物理状态
//     · qr / chat-list / splash / unknown / connecting / closed
//     · 跟 bindState 解耦 · 例: bindState=idle 但 pageState=chat-list (rehydrate · session 已恢复但没新开 bind)
//     · UI 应当只把 bindState 当 "bind UI 视图状态" · pageState 当 "诊断信息"

// ═══ 命令 (Backend → Runtime) ═══════════════════════════════════════
export type RuntimeCommandType =
  | 'init'           // 初始化 (slotId/tenantId/sessionDir/proxy/locale 等)
  | 'start-bind'     // 开始扫码
  | 'cancel-bind'    // 取消扫码
  | 'fetch-status'   // 拉当前状态
  | 'send-text'      // (D10 W2 实装) 发文本
  | 'send-media'     // (D10 W2 实装) 发媒体
  | 'shutdown';      // 优雅关闭

export interface RuntimeCommandBase {
  kind: 'cmd';
  type: RuntimeCommandType;
  requestId: string;
}

export interface InitCommand extends RuntimeCommandBase {
  type: 'init';
  // 这些字段在 D8-1 不必填 (runtime 自带 env) · 但保接口
  // D8-2 让 backend 通过 WS 推这些 · runtime 不再读 env
  noop?: true;
}

export interface StartBindCommand extends RuntimeCommandBase {
  type: 'start-bind';
  pairingPhoneNumber?: string; // 给定走 pair code · 否则 QR
}

export interface CancelBindCommand extends RuntimeCommandBase {
  type: 'cancel-bind';
}

export interface FetchStatusCommand extends RuntimeCommandBase {
  type: 'fetch-status';
}

export interface SendTextCommand extends RuntimeCommandBase {
  type: 'send-text';
  to: string;
  text: string;
}

export interface SendMediaCommand extends RuntimeCommandBase {
  type: 'send-media';
  to: string;
  mediaType: 'image' | 'video' | 'voice' | 'audio' | 'file';
  mediaBase64: string;
  caption?: string;
  fileName?: string;
}

export interface ShutdownCommand extends RuntimeCommandBase {
  type: 'shutdown';
}

export type RuntimeCommand =
  | InitCommand
  | StartBindCommand
  | CancelBindCommand
  | FetchStatusCommand
  | SendTextCommand
  | SendMediaCommand
  | ShutdownCommand;

// ═══ ACK (Runtime → Backend · 命令回执) ═══════════════════════════════
export interface RuntimeAck {
  kind: 'ack';
  requestId: string;
  ok: boolean;
  error?: string;
  data?: unknown;
}

// ═══ 事件 (Runtime → Backend) ═════════════════════════════════════════
export type RuntimeEventType =
  | 'qr'                  // 新 QR 生成 (raw data URL)
  | 'bind-state'          // bind 状态切换 (starting/qr/connecting/connected/failed/timeout)
  | 'connection-open'     // chat-list 出现 = 登录成功
  | 'connection-close'    // 跟 WA 断开
  | 'message-upsert'      // (D10 W2 实装) 收到消息
  | 'heartbeat'           // 30s 主动心跳
  | 'runtime-log'         // runtime 内部日志转发
  | 'runtime-error';      // runtime 异常 (致命/非致命)

export interface RuntimeEventBase {
  kind: 'event';
  type: RuntimeEventType;
  slotId: number;
  ts: number; // Date.now()
}

export interface QrEvent extends RuntimeEventBase {
  type: 'qr';
  /** WA Web canvas.toDataURL · 原始值 · backend 转 PNG 给 UI */
  dataUrl: string;
  qrRefreshCount: number;
}

export interface BindStateEvent extends RuntimeEventBase {
  type: 'bind-state';
  state: 'starting' | 'qr' | 'connecting' | 'connected' | 'failed' | 'cancelled' | 'timeout';
  error?: string;
}

export interface ConnectionOpenEvent extends RuntimeEventBase {
  type: 'connection-open';
  selector: string; // 命中的 chat-list selector (诊断用)
}

export interface ConnectionCloseEvent extends RuntimeEventBase {
  type: 'connection-close';
  reason: string;
  /** 'logged-out' | 'network' | 'unknown' */
  category: string;
}

export interface MessageUpsertEvent extends RuntimeEventBase {
  type: 'message-upsert';
  // D10 W2 才填 · 现在占位
  messages: unknown[];
}

export interface HeartbeatEvent extends RuntimeEventBase {
  type: 'heartbeat';
  /** runtime 自报当前 page state · 给 backend 实时同步 */
  pageState: 'qr' | 'chat-list' | 'splash' | 'splash-stuck' | 'unknown' | 'connecting' | 'closed';
  /** runtime 进程 uptime ms */
  uptimeMs: number;
  /** 当前 user-data-dir size 估计 (bytes · 看 session 是否在长 · 后续告警用) */
  profileBytes?: number;
}

export interface RuntimeLogEvent extends RuntimeEventBase {
  type: 'runtime-log';
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface RuntimeErrorEvent extends RuntimeEventBase {
  type: 'runtime-error';
  error: string;
  fatal: boolean; // backend 决定是否 respawn 进程
}

export type RuntimeEvent =
  | QrEvent
  | BindStateEvent
  | ConnectionOpenEvent
  | ConnectionCloseEvent
  | MessageUpsertEvent
  | HeartbeatEvent
  | RuntimeLogEvent
  | RuntimeErrorEvent;

// ═══ 通用 ═════════════════════════════════════════════════════════════
export type RuntimeMessage = RuntimeCommand | RuntimeAck | RuntimeEvent;

// ═══ 常量 ═════════════════════════════════════════════════════════════
export const RUNTIME_HEARTBEAT_INTERVAL_MS = 30_000;
export const RUNTIME_CMD_ACK_TIMEOUT_MS = 30_000;
export const RUNTIME_RECONNECT_BASE_MS = 1_000;
export const RUNTIME_RECONNECT_MAX_MS = 60_000;
export const RUNTIME_RECONNECT_JITTER = 0.3; // ±30%

// WS handshake 协议版本 (升级协议时 bump)
export const RUNTIME_PROTOCOL_VERSION = 1;
