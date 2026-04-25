// 2026-04-25 · D8-1 · Runtime ↔ Backend WS 协议 (backend 侧 mirror)
//
// 这份跟 packages/runtime-chromium/src/protocol/runtime-protocol.ts 同形态 ·
// D14+ 重构到 packages/shared/ 真正共享 · 现在双方各持一份不冲突.
//
// type 命名 / 字段顺序保持一致 · 防协议漂移.

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

// EventEmitter2 命名空间 (跟 baileys.worker.* 区分)
export const RUNTIME_EVENT_PREFIX = 'runtime.bridge';
export const eventName = (suffix: string): string => `${RUNTIME_EVENT_PREFIX}.${suffix}`;
