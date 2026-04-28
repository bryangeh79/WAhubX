// 2026-04-25 · D12-2 · 进程状态类型 (Codex 锁定)
//
// 范围:
//   ProcessState   per-slot 单实例的运行态
//   ProcessExitClass 退出分类 · 暂只记录 · 不 auto-respawn (Codex 边界 4)

export type ProcessExitClass =
  | 'never-started'      // 还没 start 过
  | 'normal-stop'        // 用户/系统正常 stop · 收到 exit code 0 或 SIGTERM 后正常退
  | 'spawn-failed'       // spawn() 调用本身失败 · executable 不存在 / 权限等
  | 'unexpected-exit';   // 进程突然崩 · 非 stop 调用触发

export type ProcessStatus =
  | 'starting'  // spawn 已发 · 还没 'spawn' event
  | 'running'   // 'spawn' 收到 · pid 在
  | 'stopping'  // stop() 已发 SIGTERM · 等 close
  | 'stopped'   // close 已收 · pid 已死
  | 'failed';   // spawn-failed / unexpected-exit · 进程不在 · 不会自动重启

export interface ProcessState {
  slotId: number;
  status: ProcessStatus;
  /** OS PID · running 时有 · stopped/failed 时是死的那个 pid */
  pid: number | null;
  startedAt: number | null;     // ms · spawn 事件 ts
  stoppedAt: number | null;     // ms · close 事件 ts
  exitCode: number | null;
  exitSignal: string | null;
  exitClass: ProcessExitClass;
  lastError: string | null;
  /** 重启次数 · D12-2 不自动重启 · 这里只记 manual stop 后再 start 的次数 */
  startAttempts: number;
}

export const initialProcessState = (slotId: number): ProcessState => ({
  slotId,
  status: 'stopped',
  pid: null,
  startedAt: null,
  stoppedAt: null,
  exitCode: null,
  exitSignal: null,
  exitClass: 'never-started',
  lastError: null,
  startAttempts: 0,
});
