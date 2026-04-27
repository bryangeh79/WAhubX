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
  | 'fetch-account-info'  // 2026-04-25 · 读 page 上 WA 账号信息 (phone/JID)
  | 'bring-to-front'      // 2026-04-26 · P0.10 · 把 Chromium page 提到桌面前台 (人工接管入口)
  | 'start-screencast'    // 2026-04-26 · P0.10++ · 启 CDP Page.startScreencast · 帧推 backend → 5173 canvas
  | 'stop-screencast'     // 停 screencast · 释放 CDP 资源
  | 'screencast-input'    // 反向输入事件 (mouse/key) · backend forward 到 runtime · CDP dispatch
  | 'send-text'
  | 'send-media'
  // 2026-04-26 · D11 · WA Status / Profile 真功能 (chromium 路径)
  | 'post-status-text'      // 发文字 status
  | 'post-status-media'     // 发图/视频 status (caption 可选)
  | 'browse-statuses'       // 浏览未读他人 status · runtime 直接 DOM 自驱
  | 'react-status'          // 给某条 status 表情反应
  | 'update-profile-about'  // 改个人签名/关于
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

export interface FetchAccountInfoCommand extends RuntimeCommandBase {
  type: 'fetch-account-info';
}

// 2026-04-26 · P0.10 · bring page to foreground (人工接管入口)
export interface BringToFrontCommand extends RuntimeCommandBase {
  type: 'bring-to-front';
}

// 2026-04-26 · P0.10++ · CDP screencast 嵌入 5173
export interface StartScreencastCommand extends RuntimeCommandBase {
  type: 'start-screencast';
  // 可选: 帧率 (fps) · webp 质量 · 默认 5 fps · 60% quality
  fps?: number;
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
}
export interface StopScreencastCommand extends RuntimeCommandBase {
  type: 'stop-screencast';
}

// 反向输入事件 · 5173 canvas mouse/key → backend → runtime → CDP Input.dispatch*
export interface ScreencastInputCommand extends RuntimeCommandBase {
  type: 'screencast-input';
  event:
    | { kind: 'mouse'; type: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel'; x: number; y: number; button?: 'left' | 'middle' | 'right' | 'none'; deltaX?: number; deltaY?: number; clickCount?: number }
    | { kind: 'key'; type: 'keyDown' | 'keyUp' | 'char'; text?: string; key?: string; code?: string; modifiers?: number };
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

// ═══ 2026-04-26 · D11 · Status / Profile cmd 定义 ═══

export interface PostStatusTextCommand extends RuntimeCommandBase {
  type: 'post-status-text';
  text: string;
  /** 可选: 文字 status 背景色 (WA 提供色板 · 默认随机) */
  bgColor?: string;
}

export interface PostStatusMediaCommand extends RuntimeCommandBase {
  type: 'post-status-media';
  /** 'image' | 'video' (voice/file 不能发 status) */
  mediaType: 'image' | 'video';
  mediaBase64: string;
  caption?: string;
  fileName?: string;
}

export interface BrowseStatusesCommand extends RuntimeCommandBase {
  type: 'browse-statuses';
  /** 最多看几条 (硬上限 50) */
  maxItems: number;
  /** 每条停留 (默认 3000ms · 模拟阅读) */
  dwellMs: number;
}

export interface ReactStatusCommand extends RuntimeCommandBase {
  type: 'react-status';
  /** 最多对几条 status 点赞 (硬上限 5 · 防风控) */
  maxItems: number;
  /** emoji · 默认 '👍' */
  emoji: string;
}

export interface UpdateProfileAboutCommand extends RuntimeCommandBase {
  type: 'update-profile-about';
  text: string;
}

export interface ShutdownCommand extends RuntimeCommandBase {
  type: 'shutdown';
}

export type RuntimeCommand =
  | InitCommand
  | StartBindCommand
  | CancelBindCommand
  | FetchStatusCommand
  | FetchAccountInfoCommand
  | BringToFrontCommand
  | StartScreencastCommand
  | StopScreencastCommand
  | ScreencastInputCommand
  | SendTextCommand
  | SendMediaCommand
  | PostStatusTextCommand
  | PostStatusMediaCommand
  | BrowseStatusesCommand
  | ReactStatusCommand
  | UpdateProfileAboutCommand
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
  | 'runtime-error'
  | 'screencast-frame';     // 2026-04-26 · P0.10++ · 一帧 webp base64 · runtime 推 backend forward 5173

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

// 2026-04-26 · P0.10++ · 一帧 webp base64 · 高频事件 (5 fps default)
export interface ScreencastFrameEvent extends RuntimeEventBase {
  type: 'screencast-frame';
  /** webp / jpeg base64 (无 'data:image/...;base64,' 前缀) */
  data: string;
  /** mime · 'image/webp' or 'image/jpeg' */
  mime: 'image/webp' | 'image/jpeg' | 'image/png';
  /** 宽高 */
  width: number;
  height: number;
  /** session id (sequence number for ack) */
  sessionId: number;
}

export type RuntimeEvent =
  | QrEvent
  | BindStateEvent
  | ConnectionOpenEvent
  | ConnectionCloseEvent
  | MessageUpsertEvent
  | HeartbeatEvent
  | RuntimeLogEvent
  | RuntimeErrorEvent
  | ScreencastFrameEvent;

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
