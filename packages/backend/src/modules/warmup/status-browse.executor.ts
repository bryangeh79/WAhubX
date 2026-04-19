import { Injectable } from '@nestjs/common';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../tasks/executor.interface';

// status_browse 执行器 · Day 4-5 破壳期的 reactive 动作
// Baileys 的 status feed API 在 6.7.21 上不稳定 (一些 ws 事件才能触发 status 推送).
// M5 stub: 日志 + 假设 slot 在线 5-15min, 无真拉取逻辑. M8 健康分阶段接真 ws listener.
// 目的: 让 phase gate 和 calendar 幂等链完整, 不留空槽.
@Injectable()
export class StatusBrowseExecutor implements TaskExecutor {
  readonly taskType = 'status_browse';
  readonly allowedInNightWindow = true; // 被动动作夜间允许 (只看不发)

  async execute(ctx: TaskExecutorContext): Promise<TaskExecutorResult> {
    const payload = (ctx.task.payload ?? {}) as { react?: boolean; _durationMin?: number };
    ctx.log('browse-start', true, { react: !!payload.react });
    // stub: 只记日志, 不真拉 — 真 status feed 接入在 M8
    await new Promise((r) => setTimeout(r, 100));
    ctx.log('browse-done', true, { stubbed: true });
    return { success: true };
  }
}
