import { Inject, Injectable, Logger } from '@nestjs/common';
import { TASK_EXECUTORS, type TaskExecutor } from './executor.interface';

/**
 * Registry 按 task_type 路由到 executor.
 * 不认识的 type → 返 null, dispatcher 保持任务 pending + warn (不 reject).
 */
@Injectable()
export class ExecutorRegistry {
  private readonly logger = new Logger(ExecutorRegistry.name);
  private readonly byType = new Map<string, TaskExecutor>();

  constructor(@Inject(TASK_EXECUTORS) executors: TaskExecutor[]) {
    for (const ex of executors) {
      if (this.byType.has(ex.taskType)) {
        throw new Error(`Duplicate executor for task_type="${ex.taskType}"`);
      }
      this.byType.set(ex.taskType, ex);
    }
    this.logger.log(`Registered ${this.byType.size} executors: ${[...this.byType.keys()].join(', ')}`);
  }

  get(taskType: string): TaskExecutor | null {
    return this.byType.get(taskType) ?? null;
  }

  has(taskType: string): boolean {
    return this.byType.has(taskType);
  }

  isAllowedInNightWindow(taskType: string): boolean {
    const ex = this.byType.get(taskType);
    if (!ex) return false;
    return ex.allowedInNightWindow;
  }

  listTypes(): string[] {
    return [...this.byType.keys()];
  }
}
