import { Injectable, Logger } from '@nestjs/common';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../tasks/executor.interface';
import { ScriptRunnerService } from './script-runner.service';

// script_chat 执行器 — 替代 M3 的 chat stub, 真驱动剧本 turns.
// Payload 要求:
//   { scriptId: number,         // script.id (DB)
//     roleAaccountId: number,   // 角色 A 账号
//     roleBaccountId: number,   // 角色 B 账号
//     sessionIndex?: number,    // 默认 0
//     fastMode?: boolean }      // dev 加速
// 注意: task.target_ids 当前只带 A (B 从 payload 拿) — M4 单 target, 未来 group 才走双 target
@Injectable()
export class ScriptChatExecutor implements TaskExecutor {
  readonly taskType = 'script_chat';
  readonly allowedInNightWindow = false; // 聊天剧本白天跑 (同 chat)
  private readonly logger = new Logger(ScriptChatExecutor.name);

  constructor(private readonly runner: ScriptRunnerService) {}

  async execute(ctx: TaskExecutorContext): Promise<TaskExecutorResult> {
    const payload = (ctx.task.payload ?? {}) as {
      scriptId?: number;
      roleAaccountId?: number;
      roleBaccountId?: number;
      sessionIndex?: number;
      fastMode?: boolean;
    };
    if (!payload.scriptId || !payload.roleAaccountId || !payload.roleBaccountId) {
      return {
        success: false,
        errorCode: 'INVALID_PAYLOAD',
        errorMessage: 'script_chat payload 需 { scriptId, roleAaccountId, roleBaccountId }',
      };
    }

    ctx.log('script-start', true, { scriptId: payload.scriptId });
    try {
      const result = await this.runner.run({
        scriptId: payload.scriptId,
        roleAaccountId: payload.roleAaccountId,
        roleBaccountId: payload.roleBaccountId,
        sessionIndex: payload.sessionIndex,
        fastMode: payload.fastMode ?? false,
      });
      ctx.log('script-done', result.errors.length === 0, {
        turnsExecuted: result.turnsExecuted,
        turnsSkipped: result.turnsSkipped,
        errorCount: result.errors.length,
      });
      if (result.errors.length > 0) {
        return {
          success: false,
          errorCode: 'TURN_ERRORS',
          errorMessage: `${result.errors.length} turns failed: ${result.errors.map((e) => `t${e.turn}=${e.error}`).join('; ')}`,
        };
      }
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`script_chat task ${ctx.task.id} failed: ${msg}`);
      return { success: false, errorCode: 'RUNNER_THREW', errorMessage: msg };
    }
  }
}
