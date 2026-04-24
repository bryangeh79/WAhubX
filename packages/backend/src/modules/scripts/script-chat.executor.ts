import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../tasks/executor.interface';
import { ScriptRunnerService } from './script-runner.service';
import { ScriptEntity } from './script.entity';
import { WarmupPairService } from '../warmup/warmup-pair.service';

// script_chat 执行器 — 替代 M3 的 chat stub, 真驱动剧本 turns.
// Payload 要求:
//   { scriptId: number,         // script.id (DB)
//     roleAaccountId: number,   // 角色 A 账号
//     roleBaccountId?: number,  // 角色 B 账号 (手动配置模式; M5 日历模式缺省, 由 _needPair 触发运行时挑)
//     sessionIndex?: number,    // 默认 0
//     fastMode?: boolean,       // dev 加速
//     _needPair?: boolean }     // M5 warmup calendar 模式: B 由 WarmupPairService 现场挑
@Injectable()
export class ScriptChatExecutor implements TaskExecutor {
  readonly taskType = 'script_chat';
  readonly allowedInNightWindow = false; // 聊天剧本白天跑 (同 chat)
  private readonly logger = new Logger(ScriptChatExecutor.name);

  constructor(
    private readonly runner: ScriptRunnerService,
    private readonly pairService: WarmupPairService,
    @InjectRepository(ScriptEntity) private readonly scriptRepo: Repository<ScriptEntity>,
  ) {}

  async execute(ctx: TaskExecutorContext): Promise<TaskExecutorResult> {
    const payload = (ctx.task.payload ?? {}) as {
      scriptId?: number;
      roleAaccountId?: number;
      roleBaccountId?: number;
      sessionIndex?: number;
      fastMode?: boolean;
      _needPair?: boolean;
      forceOverride?: boolean;  // 2026-04-21 · admin 前端强制覆盖 warmup gate
    };
    if (!payload.scriptId || !payload.roleAaccountId) {
      return {
        success: false,
        errorCode: 'INVALID_PAYLOAD',
        errorMessage: 'script_chat payload 需 { scriptId, roleAaccountId }',
      };
    }

    // M5 calendar 模式: 运行时挑 partner
    let roleB = payload.roleBaccountId;
    if (!roleB && payload._needPair) {
      const script = await this.scriptRepo.findOne({ where: { id: payload.scriptId } });
      if (!script) {
        return { success: false, errorCode: 'SCRIPT_NOT_FOUND', errorMessage: `script ${payload.scriptId} 不存在` };
      }
      const partnerId = await this.pairService.pickPartner(payload.roleAaccountId, script.minWarmupStage);
      if (!partnerId) {
        ctx.log('pair-skip', false, { reason: 'no eligible pair' });
        return { success: false, errorCode: 'NO_PAIR_AVAILABLE', errorMessage: '同租户内无可配对号 (IP 组/stage/takeover/status 过滤后为空)' };
      }
      roleB = partnerId;
      ctx.log('pair-picked', true, { partnerId });
    }
    if (!roleB) {
      return {
        success: false,
        errorCode: 'INVALID_PAYLOAD',
        errorMessage: 'script_chat payload 需 roleBaccountId 或 _needPair=true',
      };
    }

    ctx.log('script-start', true, { scriptId: payload.scriptId });
    try {
      const result = await this.runner.run({
        scriptId: payload.scriptId,
        roleAaccountId: payload.roleAaccountId,
        roleBaccountId: roleB,
        sessionIndex: payload.sessionIndex,
        fastMode: payload.fastMode ?? false,
        forceOverride: payload.forceOverride ?? false,
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
