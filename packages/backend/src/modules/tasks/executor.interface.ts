// 每个 executor 注册一个 taskType string. dispatcher 碰到未知 type 不 reject, 保持 pending + warn.
// M4/M5/M6/M7 加新 executor 不用改 M3 dispatcher 代码.
import type { TaskEntity } from './task.entity';
import type { TaskRunEntity } from './task-run.entity';

export interface TaskExecutorContext {
  task: TaskEntity;
  // 单 account 任务: 这里就是 target_ids[0] 解析出的 accountId
  // 组任务 (M4): dispatcher 已展开成 N 个独立 run
  accountId: number;
  // 运行期日志追加器. executor 调 ctx.log('step-name', true, {...}) 落 task_run.logs
  log: (step: string, ok: boolean, meta?: Record<string, unknown>) => void;
  // M9 · 接管抢占检查 hook. executor 在 natural breakpoint (turn 之间) 调:
  //   ctx.throwIfPaused?.()      → 被接管则抛 TaskPausedError, dispatcher 标 task_run=paused, 不扣分
  //   ctx.isPaused?.()           → 返回 boolean 的只读探针, 供 executor 自己决定是 return skip 还是 throw
  // 可选 · M3 spec 的 executor 不用改; 新 executor 可选接入.
  throwIfPaused?: () => void;
  isPaused?: () => boolean;
}

export interface TaskExecutorResult {
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface TaskExecutor {
  /** 必须与 task.task_type 字符串一致 */
  readonly taskType: string;

  /**
   * 夜间窗口 (02-06) 仲裁规则: 只放行返回 true 的 executor.
   * warmup / maintenance → true; chat / other → false.
   */
  readonly allowedInNightWindow: boolean;

  execute(ctx: TaskExecutorContext): Promise<TaskExecutorResult>;
}

// 用于 DI token — Nest provider 用这个 symbol 挂 executor 列表
export const TASK_EXECUTORS = Symbol('TASK_EXECUTORS');
export type TaskRunPatch = Partial<Pick<TaskRunEntity, 'status' | 'finishedAt' | 'errorCode' | 'errorMessage'>>;
