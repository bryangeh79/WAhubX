import { Injectable, Logger } from '@nestjs/common';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../executor.interface';

// 2026-04-28 · Phase D · chromium-only · group invite 链路在 chromium runtime 暂未实现
// (B3 deferred · group-invite DOM 自动化留给后续真机验证)
@Injectable()
export class JoinGroupExecutor implements TaskExecutor {
  readonly taskType = 'join_group';
  readonly allowedInNightWindow = false;

  private readonly logger = new Logger(JoinGroupExecutor.name);

  async execute(ctx: TaskExecutorContext): Promise<TaskExecutorResult> {
    const payload = (ctx.task.payload ?? {}) as { inviteCode?: string };
    if (!payload.inviteCode) {
      return { success: false, errorCode: 'INVALID_PAYLOAD', errorMessage: 'inviteCode 必填' };
    }
    ctx.log('skip-not-supported-chromium', true, { inviteCode: payload.inviteCode });
    this.logger.log(
      `join_group ${ctx.task.id} skip · chromium runtime 暂不支持 group invite (Phase B3 留给真机验证)`,
    );
    return {
      success: false,
      errorCode: 'NOT_SUPPORTED',
      errorMessage: 'chromium runtime 暂不支持 join_group · 留待 Phase B3 真机验证后实装',
    };
  }
}
