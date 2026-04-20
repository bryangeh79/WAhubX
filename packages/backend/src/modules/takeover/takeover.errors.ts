/**
 * M9 · 接管 UI 专用错误类
 *
 * TaskPausedError    — executor 在 breakpoint 检测到接管抢占, 自愿退出. dispatcher 捕获后把
 *                      task_run.status → 'paused' (不是 failed), 不扣 risk_event 分.
 * TaskInterruptedError — hard-kill 路径: 30s 未 graceful pause, 用户主动强制中断.
 *                      dispatcher 捕获后 task_run.status → 'interrupted', 同样不扣分.
 * TakeoverLockError  — 锁冲突 / 权限不足 / 槽位非法等业务错误, controller 抛给前端.
 */

export class TaskPausedError extends Error {
  readonly errorCode = 'TASK_PAUSED';
  constructor(
    public readonly accountId: number,
    public readonly snapshot?: Record<string, unknown>,
  ) {
    super(`task paused by takeover on account ${accountId}`);
    this.name = 'TaskPausedError';
  }
}

export class TaskInterruptedError extends Error {
  readonly errorCode = 'TASK_INTERRUPTED';
  constructor(
    public readonly accountId: number,
    public readonly reason: string = 'hard-kill',
  ) {
    super(`task interrupted on account ${accountId}: ${reason}`);
    this.name = 'TaskInterruptedError';
  }
}

export class TakeoverLockError extends Error {
  constructor(
    public readonly code:
      | 'LOCK_HELD_BY_OTHER'
      | 'NO_ACTIVE_LOCK'
      | 'SLOT_NOT_FOUND'
      | 'ACCOUNT_NOT_BOUND'
      | 'PERMISSION_DENIED',
    message: string,
  ) {
    super(message);
    this.name = 'TakeoverLockError';
  }
}
