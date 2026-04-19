import { Injectable, Logger } from '@nestjs/common';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../executor.interface';

// M3 stub: 只打日志 + 睡 500ms 模拟工作, 证明 registry 路由通过.
// M5 养号日历实装时接具体步骤 (发日志/开朋友圈/加好友等).
@Injectable()
export class WarmupExecutor implements TaskExecutor {
  readonly taskType = 'warmup';
  readonly allowedInNightWindow = true; // 夜间允许 (技术交接文档 § 5.2)

  private readonly logger = new Logger(WarmupExecutor.name);

  async execute(ctx: TaskExecutorContext): Promise<TaskExecutorResult> {
    this.logger.log(`warmup task ${ctx.task.id} on account ${ctx.accountId} (stub M3 — M5 实装)`);
    ctx.log('warmup-start', true, { accountId: ctx.accountId });
    await new Promise((r) => setTimeout(r, 500));
    ctx.log('warmup-tick', true, {});
    return { success: true };
  }
}
