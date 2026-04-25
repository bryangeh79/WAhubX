// 2026-04-25 · D9-1 · Runtime ↔ Backend WS 协议 · SHARED 单一来源
//
// 这是 backend 跟 runtime-chromium 的协议定义唯一来源 (Codex D9 边界 1 锁定).
// 两端通过 @wahubx/shared/runtime-protocol 直接 import · 不再各持 mirror copy.
//
// 范围 (Codex D9 边界 1 锁定):
//   ✓ bind 命令/事件 (start-bind/cancel-bind/fetch-status/qr/bind-state/connection-open/close)
//   ✓ 基础事件 (heartbeat/runtime-log/runtime-error)
//   ✓ send 签名 (send-text/send-media · 实装可能 stub · 但类型必须定)
//   ✗ 不含 inbound 高级路径 (留 D11+)
//   ✗ 不含恢复/quarantine 策略 (留 D11+)
//
// 序列化: 全部走 JSON. kind: 'cmd' | 'ack' | 'event'.
// 命令 / ACK 用 requestId 关联. 事件单向推 · 不带 requestId.
//
// 语义边界 (D8-3 · Codex 锁):
//   bindState — bind session 状态 (idle/starting/qr/connecting/connected/timeout/cancelled/failed)
//   pageState — 页面物理状态 (qr/chat-list/splash/closed/etc)
//   两者解耦 · UI 视图取 bindState · 诊断取 pageState.

export type RuntimeCommandType =
  | 'init'
  | 'start-bind'
  | 'cancel-bind'
  | 'fetch-status'
  | 'send-text'
  | 'send-media'
  | 'shutdown';

export interface RuntimeCommandBase {
  kind: 'cmd';
  type: RuntimeCommandType;
  requestId: string;
}

export interface InitCommand extends RuntimeCommandBase {
  type: 'init';
  noop?: true;
}

export interface StartBindCommand extends RuntimeCommandBase {
  type: 'start-bind';
  pairingPhoneNumber?: string;
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

export interface RuntimeAck {
  kind: 'ack';
  requestId: string;
  ok: boolean;
  error?: string;
  data?: unknown;
}

export type RuntimeEventType =
  | 'qr'
  | 'bind-state'
  | 'connection-open'
  | 'connection-close'
  | 'message-upsert'
  | 'heartbeat'
  | 'runtime-log'
  | 'runtime-error';

export interface RuntimeEventBase {
  kind: 'event';
  type: RuntimeEventType;
  slotId: number;
  ts: number;
}

export interface QrEvent extends RuntimeEventBase {
  type: 'qr';
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
  selector: string;
}

export interface ConnectionCloseEvent extends RuntimeEventBase {
  type: 'connection-close';
  reason: string;
  category: string;
}

export interface MessageUpsertEvent extends RuntimeEventBase {
  type: 'message-upsert';
  messages: unknown[];
}

export interface HeartbeatEvent extends RuntimeEventBase {
  type: 'heartbeat';
  pageState: 'qr' | 'chat-list' | 'splash' | 'splash-stuck' | 'unknown' | 'connecting' | 'closed';
  uptimeMs: number;
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
  fatal: boolean;
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

export type RuntimeMessage = RuntimeCommand | RuntimeAck | RuntimeEvent;

export const RUNTIME_HEARTBEAT_INTERVAL_MS = 30_000;
export const RUNTIME_CMD_ACK_TIMEOUT_MS = 30_000;
export const RUNTIME_PROTOCOL_VERSION = 1;

// Runtime WS 重连参数 (runtime-chromium 用)
export const RUNTIME_RECONNECT_BASE_MS = 1_000;
export const RUNTIME_RECONNECT_MAX_MS = 60_000;
export const RUNTIME_RECONNECT_JITTER = 0.3; // ±30%

// EventEmitter2 命名空间 (跟 baileys.worker.* 区分)
export const RUNTIME_EVENT_PREFIX = 'runtime.bridge';
export const eventName = (suffix: string): string => `${RUNTIME_EVENT_PREFIX}.${suffix}`;
