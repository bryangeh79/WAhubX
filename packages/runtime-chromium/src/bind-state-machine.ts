// 2026-04-25 · D8-2 · bind 流程状态机 (Codex 锁定 · 严格单向不回退)
//
// 状态:
//   idle           初始 / 一轮结束后
//   starting       收到 start-bind 命令 · 流程启动
//   qr             页面进 qr 状态 · 等扫
//   connecting     chat-list selector 命中 · 在 15s flush
//   connected      15s flush 完 · session 可用
//   timeout        wait-for-login 超时 · 一轮结束 · 可重新 start-bind
//   cancelled      收到 cancel-bind 命令 · 一轮结束
//   failed         异常 · 一轮结束
//
// 合法转移:
//   idle        → starting
//   starting    → qr | connecting | timeout | cancelled | failed
//   qr          → connecting | timeout | cancelled | failed
//   connecting  → connected | failed (异常 · 极少)
//   connected   → idle (重新一轮 · 或 disconnect 触发)
//   timeout     → idle (重新一轮)
//   cancelled   → idle (重新一轮)
//   failed      → idle (重新一轮)
//
// 不允许:
//   qr → starting (回退)
//   connected → qr (回退)
//   任何 → connected 跳过 connecting (除 idle 路径直接 chat-list rehydrate · 视为 starting → connecting → connected)

import type { Logger } from 'pino';
import type { BindStateEvent } from './protocol/runtime-protocol';

export type BindState = BindStateEvent['state'] | 'idle';

const ALLOWED: Record<BindState, BindState[]> = {
  idle: ['starting'],
  starting: ['qr', 'connecting', 'timeout', 'cancelled', 'failed'],
  qr: ['connecting', 'timeout', 'cancelled', 'failed'],
  connecting: ['connected', 'failed'],
  connected: ['idle'],
  timeout: ['idle'],
  cancelled: ['idle'],
  failed: ['idle'],
};

const TERMINAL_STATES: ReadonlySet<BindState> = new Set([
  'connected',
  'timeout',
  'cancelled',
  'failed',
]);

export class BindStateMachine {
  private current: BindState = 'idle';
  private startedAt = 0;
  private lastTransitionAt = Date.now();

  constructor(private log: Logger) {}

  get state(): BindState {
    return this.current;
  }

  /** 流程开始时间 (start-bind 收到 ts) · idle = 0 */
  get sessionStartedAt(): number {
    return this.startedAt;
  }

  /**
   * 尝试转移 · 非法转移返 false 并 log warn · 不抛
   * 调用方拿 false 应当中止当前 emit · 不要继续往 backend 推
   */
  tryTransition(next: BindState, reason?: string): boolean {
    if (next === this.current) {
      // 同状态再次 emit · 静默忽略 (不算错)
      return false;
    }
    const allowed = ALLOWED[this.current] ?? [];
    if (!allowed.includes(next)) {
      this.log.warn(
        {
          from: this.current,
          to: next,
          allowed,
          reason: reason ?? '',
        },
        'D8-2 bind state machine: illegal transition · ignored',
      );
      return false;
    }
    this.log.info(
      { from: this.current, to: next, reason: reason ?? '' },
      'D8-2 bind state transition',
    );
    if (this.current === 'idle' && next === 'starting') {
      this.startedAt = Date.now();
    }
    this.current = next;
    this.lastTransitionAt = Date.now();
    return true;
  }

  /**
   * 流程结束 · 把 terminal state 重置回 idle · 给下一轮 start-bind 用
   */
  resetIfTerminal(): boolean {
    if (TERMINAL_STATES.has(this.current)) {
      return this.tryTransition('idle', 'reset after terminal');
    }
    return false;
  }

  /** 是否在跑 bind 流程 (非 idle 非 terminal) */
  isInProgress(): boolean {
    return this.current === 'starting' || this.current === 'qr' || this.current === 'connecting';
  }
}
