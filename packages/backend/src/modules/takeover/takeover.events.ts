/**
 * M9 · EventEmitter2 channel 常量 + payload 类型
 * 复用 M8 同一 EventEmitter2 bus (app.module.ts forRoot · wildcard=true).
 *
 * 命名空间 'takeover.*' 与 M8 'risk.*' 正交, 互不干扰.
 */

export const TAKEOVER_ACQUIRED = 'takeover.acquired';
export const TAKEOVER_RELEASED = 'takeover.released';
export const TAKEOVER_HARD_KILL = 'takeover.hard_kill';
export const TAKEOVER_MESSAGE_IN = 'takeover.message.in';   // baileys 收到消息
export const TAKEOVER_MESSAGE_OUT = 'takeover.message.out'; // 手动发消息落库回显
export const TAKEOVER_IDLE_WARNING = 'takeover.idle_warning'; // 28min 提醒
export const TAKEOVER_IDLE_TIMEOUT = 'takeover.idle_timeout'; // 30min 自动释放

export interface TakeoverAcquiredEvent {
  accountId: number;
  slotId: number;
  userId: string;
  userEmail: string;
  acquiredAt: string;
}

export interface TakeoverReleasedEvent {
  accountId: number;
  reason: 'manual' | 'idle_timeout' | 'disconnect_timeout' | 'shutdown';
  userId: string | null;
}

export interface TakeoverHardKillEvent {
  accountId: number;
  interruptedRunIds: number[];
  userId: string;
}

export interface TakeoverMessageEvent {
  accountId: number;
  contactId: number;
  messageId: string; // chat_message.id (bigint as string)
  remoteJid: string;
  direction: 'in' | 'out';
  msgType: 'text' | 'image' | 'voice' | 'file' | 'other';
  content: string | null;
  mediaPath: string | null;
  waMessageId: string | null;
  sentAt: string;
  // 手动发标记 (script_run_id IS NULL)
  manual: boolean;
  // 2026-04-25 · D11-3 · slot 角色 (broadcast | customer_service)
  // 业务订阅者按这字段 gate · broadcast 号 inbound log only · 不进 auto-reply / takeover 链
  // (Codex 边界 3: 不直接吞没 · 仍 emit · 但订阅者按 role 决定是否处理)
  slotRole?: 'broadcast' | 'customer_service';
}

export interface TakeoverIdleEvent {
  accountId: number;
  minutesIdle: number;
}
