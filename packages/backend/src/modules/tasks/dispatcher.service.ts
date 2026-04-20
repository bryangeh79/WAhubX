// 调度器: 每 3 秒扫一轮 (技术交接文档 § 5.2).
// 核心职责: 从 pending 任务池挑候选, 过 5 条拒绝路径 + 夜间窗口, 剩下的下发 executor.
//
// 收工硬标准 (用户 2026-04-19 定): 5 种拒绝路径必须有单元测试覆盖. 见 dispatcher.service.spec.ts.
import {
  Injectable,
  Logger,
  Optional,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, IsNull, LessThanOrEqual } from 'typeorm';
import { TaskEntity, TaskStatus, TaskTargetType } from './task.entity';
import { TaskRunEntity, TaskRunStatus } from './task-run.entity';
import { AccountSlotEntity } from '../slots/account-slot.entity';
import { WaAccountEntity, WarmupStage } from '../slots/wa-account.entity';
import { AccountHealthEntity, RiskLevel } from '../slots/account-health.entity';
import { ExecutorRegistry } from './executor-registry.service';
import type { TaskExecutorContext } from './executor.interface';
import { HealthSettingsService } from '../account-health/health-settings.service';
import { RISK_EVENT_CHANNEL, type RiskRawEvent } from '../account-health/risk.events';
import { RiskEventCode } from '../account-health/risk-event.entity';
import { TakeoverLockService } from '../takeover/takeover-lock.service';
import { TaskPausedError, TaskInterruptedError } from '../takeover/takeover.errors';

// 5 条拒绝路径 + soft skip (warmup_stage)
// M8 · 加第 6 条: skip-health-high (risk_level=high 且非 dry_run 时)
export type DispatchDecision =
  | { action: 'run'; accountId: number; healthDegrade?: 'medium' } // M8 · medium 降档时带标记
  | { action: 'skip-global-capacity' }      // #1 全局 6 槽已满
  | { action: 'skip-account-busy' }         // #2 该账号有任务在跑
  | { action: 'skip-ip-group-busy' }        // #3 该账号 IP 组有任务在跑 (proxy_id 相同)
  | { action: 'skip-takeover-active' }      // #4 该账号在接管中
  | { action: 'skip-night-window' }         // 夜间只放行 warmup/maintenance
  | { action: 'skip-health-high' }          // #6 M8 · 健康分 high 暂停主动任务
  | { action: 'soft-warn-warmup-stage' }    // #5 soft: warmup_stage 不够, 允许执行 + 记警告
  | { action: 'leave-pending-unknown-type' }; // executor 未注册 → 不 reject 不 run, 保 pending

export interface DispatchContext {
  now: Date;
  runningAccountIds: Set<number>;
  runningProxyIds: Set<number>;
  runningCount: number;
  maxConcurrency: number;
}

// 任务类型到所需 warmup_stage 的映射 (rejection #5 依据)
// 新 type 不在此表默认不限制 (最小阶段 0); M4/M5 剧本可扩展
export const MIN_WARMUP_STAGE_BY_TASK_TYPE: Record<string, WarmupStage> = {
  warmup: WarmupStage.Incubation,      // 任何阶段都可
  maintenance: WarmupStage.Incubation,
  chat: WarmupStage.Prewarm,            // 预热期及以后才可聊天
  auto_accept: WarmupStage.Prewarm,
  status: WarmupStage.Active,
};

@Injectable()
export class DispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DispatcherService.name);
  private pollTimer: NodeJS.Timeout | null = null;
  private busy = false; // 防止上一轮未结束下一轮开始 (长任务并发调度)

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly registry: ExecutorRegistry,
    // M8 · optional 为了 M3 单测仍能 new DispatcherService(...)
    @Optional() private readonly eventBus?: EventEmitter2,
    @Optional() private readonly healthSettings?: HealthSettingsService,
    // M9 · 可选注入 (M3 单测跳过); 运行期注入后 executor 能拿到 throwIfPaused hook
    @Optional() private readonly takeoverLock?: TakeoverLockService,
  ) {}

  onModuleInit(): void {
    const interval = this.config.get<number>('SCHEDULER_POLL_INTERVAL_MS', 3000);
    this.pollTimer = setInterval(() => {
      if (this.busy) return;
      this.busy = true;
      this.tick()
        .catch((err) => this.logger.error(`dispatcher tick error: ${err}`))
        .finally(() => {
          this.busy = false;
        });
    }, interval);
    this.logger.log(`Dispatcher started, poll interval=${interval}ms, max concurrency=${this.config.get<number>('SCHEDULER_MAX_CONCURRENCY', 6)}`);
  }

  onModuleDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * 一轮调度 (public 方便测试直接调用跳过 interval)
   */
  async tick(now: Date = new Date()): Promise<void> {
    const maxConcurrency = this.config.get<number>('SCHEDULER_MAX_CONCURRENCY', 6);

    // 建上下文快照 (同一 tick 内所有决策用同一份)
    const ctx = await this.buildContext(now, maxConcurrency);
    if (ctx.runningCount >= ctx.maxConcurrency) {
      return; // #1 直接 skip, 省查 task 表
    }

    // 取候选: pending + (scheduled_at 为 null 或已到期), 按 priority 升, 同级按 scheduled_at 升
    const candidates = await this.dataSource.getRepository(TaskEntity).find({
      where: [
        { status: TaskStatus.Pending, scheduledAt: IsNull() },
        { status: TaskStatus.Pending, scheduledAt: LessThanOrEqual(now) },
      ],
      order: { priority: 'ASC', scheduledAt: 'ASC', id: 'ASC' },
      take: 50, // 一轮最多处理 50 个候选, 防长尾拖死 tick
    });

    for (const task of candidates) {
      if (ctx.runningCount >= ctx.maxConcurrency) break;
      const decision = await this.decide(task, ctx, now);
      await this.applyDecision(task, decision, ctx);
    }
  }

  /**
   * 单任务决策. 纯函数 (只读 ctx + DB 查询), 便于单测覆盖 5 条拒绝路径.
   */
  async decide(task: TaskEntity, ctx: DispatchContext, now: Date = new Date()): Promise<DispatchDecision> {
    // 必须先有 executor, 不然连看都不看 (避免误跑)
    if (!this.registry.has(task.taskType)) {
      return { action: 'leave-pending-unknown-type' };
    }

    // 夜间窗口 (02-06) 只放行 allowedInNightWindow=true 的 executor
    if (this.isInNightWindow(now) && !this.registry.isAllowedInNightWindow(task.taskType)) {
      return { action: 'skip-night-window' };
    }

    // 解析目标账号 (M3 只处理 single-account; group 留 M4)
    if (task.targetType !== TaskTargetType.Account || task.targetIds.length === 0) {
      return { action: 'leave-pending-unknown-type' }; // 不支持的 target_type 按未知处理
    }
    const accountId = task.targetIds[0];

    // 读槽位信息 (需要 proxy_id + takeover_active + account.warmup_stage)
    const slot = await this.dataSource.getRepository(AccountSlotEntity).findOne({
      where: { accountId },
    });
    if (!slot) {
      return { action: 'leave-pending-unknown-type' }; // 账号不存在或未挂槽, 保 pending 让人工排查
    }

    // #1 全局并发
    if (ctx.runningCount >= ctx.maxConcurrency) {
      return { action: 'skip-global-capacity' };
    }

    // #2 同账号互斥
    if (ctx.runningAccountIds.has(accountId)) {
      return { action: 'skip-account-busy' };
    }

    // #3 同 IP 组 (proxy_id 相同) 互斥. proxy_id=null 算 "直连组", 所有直连账号共一组.
    // 设计权衡: dev 环境 + 租户没配代理时 null 组会互锁. 生产规范要求每槽绑 proxy.
    if (slot.proxyId !== null && ctx.runningProxyIds.has(slot.proxyId)) {
      return { action: 'skip-ip-group-busy' };
    }
    if (slot.proxyId === null && ctx.runningProxyIds.has(-1)) {
      // 用 -1 代表 "null proxy group"
      return { action: 'skip-ip-group-busy' };
    }

    // #4 接管中
    if (slot.takeoverActive) {
      return { action: 'skip-takeover-active' };
    }

    // #5 soft: warmup_stage 不够. 允许执行但记警告 (不 reject)
    const wa = await this.dataSource.getRepository(WaAccountEntity).findOne({ where: { id: accountId } });
    const requiredStage = MIN_WARMUP_STAGE_BY_TASK_TYPE[task.taskType];
    if (requiredStage !== undefined && wa && wa.warmupStage < requiredStage) {
      this.logger.warn(
        `task ${task.id} (${task.taskType}) runs on account ${accountId} at stage ${wa.warmupStage} < required ${requiredStage} — soft warn, allowed`,
      );
      // 落 soft-warn 后仍 run, 不 reject
    }

    // #6 M8 · 健康分 gate. dry_run 不拦截, 只标记 meta
    const health = await this.dataSource
      .getRepository(AccountHealthEntity)
      .findOne({ where: { accountId } });
    if (health) {
      const dryRun = this.healthSettings ? await this.healthSettings.isDryRun() : false;
      if (health.riskLevel === RiskLevel.High && !dryRun) {
        // M5 maybeRegress 路径已把该号养号阶段回退, 任务这里直接跳
        return { action: 'skip-health-high' };
      }
      if (health.riskLevel === RiskLevel.Medium && !dryRun) {
        // medium · 允许跑但带标记 (executor/runner 后续按 healthDegrade 放慢 send_delay)
        return { action: 'run', accountId, healthDegrade: 'medium' };
      }
    }

    return { action: 'run', accountId };
  }

  private async applyDecision(
    task: TaskEntity,
    decision: DispatchDecision,
    ctx: DispatchContext,
  ): Promise<void> {
    switch (decision.action) {
      case 'run':
        await this.startRun(task, decision.accountId, ctx, decision.healthDegrade);
        return;
      case 'skip-global-capacity':
      case 'skip-account-busy':
      case 'skip-ip-group-busy':
      case 'skip-takeover-active':
      case 'skip-night-window':
        // 保 pending 让下一轮 tick 重新评估
        return;
      case 'skip-health-high':
        // M8 · 健康分 high · 观察性 log (cascade [3] 验证 · 原无 log)
        this.logger.warn(
          `task ${task.id} (${task.taskType}) skip-health-high · acc=${task.targetIds[0]} · 保 pending`,
        );
        return;
      case 'leave-pending-unknown-type':
        // 按用户 2A 约束: warn + 保 pending, 不 reject
        this.logger.warn(
          `Unknown task_type "${task.taskType}" (task id=${task.id}) — left pending. ` +
            `Registered types: ${this.registry.listTypes().join(', ')}`,
        );
        return;
      case 'soft-warn-warmup-stage':
        // 当前 decide() 在 run 路径里内联记 warn; 这条 branch 保留以防将来抽出来
        return;
    }
  }

  private async startRun(
    task: TaskEntity,
    accountId: number,
    ctx: DispatchContext,
    healthDegrade?: 'medium',
  ): Promise<void> {
    if (healthDegrade === 'medium') {
      this.logger.warn(
        `task ${task.id} on acc ${accountId} runs in DEGRADED mode (risk_level=medium) · executor 应放慢 send_delay × 1.5`,
      );
      // executor 从 task.payload._healthDegrade 读
      task.payload = { ...(task.payload ?? {}), _healthDegrade: 'medium' };
    }
    // 原子事务: task.status=queued → 新建 task_run (running) → 提交后异步跑 executor
    let runId!: number;
    await this.dataSource.transaction(async (m) => {
      await m.update(TaskEntity, task.id, { status: TaskStatus.Queued });
      const run = m.create(TaskRunEntity, {
        taskId: task.id,
        accountId,
        startedAt: new Date(),
        status: TaskRunStatus.Running,
        logs: [],
      });
      const saved = await m.save(run);
      runId = saved.id;
    });
    ctx.runningCount += 1;
    ctx.runningAccountIds.add(accountId);
    // 记 proxy 组 (需再查一次 slot, 上面 decide 已查过但没提上来; 重复查成本低)
    const slot = await this.dataSource
      .getRepository(AccountSlotEntity)
      .findOne({ where: { accountId } });
    ctx.runningProxyIds.add(slot?.proxyId ?? -1);

    // 异步跑 — tick 不阻塞等待
    void this.executeInBackground(task, runId, accountId);
  }

  private async executeInBackground(task: TaskEntity, runId: number, accountId: number): Promise<void> {
    const executor = this.registry.get(task.taskType);
    if (!executor) {
      // 理论到不了这 (decide 已过 registry 检查), 保险
      await this.finishRun(runId, task.id, TaskRunStatus.Failed, 'UNKNOWN_EXECUTOR', 'executor disappeared');
      return;
    }

    const logs: Array<{ at: string; step: string; ok: boolean; meta?: Record<string, unknown> }> = [];
    const ctx: TaskExecutorContext = {
      task,
      accountId,
      log: (step, ok, meta) => {
        logs.push({ at: new Date().toISOString(), step, ok, meta });
      },
      // M9 · 接管抢占探针 (optional 注入)
      isPaused: () => this.takeoverLock?.isPaused(accountId) ?? false,
      throwIfPaused: () => {
        if (this.takeoverLock?.isPaused(accountId)) {
          throw new TaskPausedError(accountId);
        }
      },
    };

    try {
      await this.dataSource.getRepository(TaskEntity).update(task.id, { status: TaskStatus.Running });
      const result = await executor.execute(ctx);
      // logs 有嵌套 Record<string, unknown>, TypeORM 类型严格不认 — 整块 as unknown 绕开
      await this.dataSource.query(
        `UPDATE task_run SET logs = $1, finished_at = NOW(), status = $2, error_code = $3, error_message = $4 WHERE id = $5`,
        [JSON.stringify(logs), result.success ? 'success' : 'failed', result.errorCode ?? null, result.errorMessage ?? null, runId],
      );
      await this.dataSource.getRepository(TaskEntity).update(task.id, {
        status: result.success ? TaskStatus.Done : TaskStatus.Failed,
        lastError: result.success ? null : (result.errorMessage ?? 'executor reported failure'),
      });
      // M8 · emit risk event on failure (send_failed for real send errors, generic failure otherwise)
      if (!result.success) {
        this.emitRisk({
          accountId,
          code: RiskEventCode.SendFailed,
          severity: 'warn',
          source: 'task_runner',
          sourceRef: `task_run:${runId}`,
          meta: { taskId: task.id, errorCode: result.errorCode, taskType: task.taskType },
        });
      }
    } catch (err) {
      // M9 · 接管抢占 · 不计失败, task_run=paused, task=pending, 等 release 后下一 tick 续跑
      if (err instanceof TaskPausedError) {
        this.logger.warn(`task ${task.id} paused by takeover on acc ${accountId} · task_run → paused`);
        await this.dataSource.query(
          `UPDATE task_run SET logs = $1, finished_at = NOW(), status = 'paused', pause_snapshot = $2, error_code = 'TAKEOVER_PAUSED', error_message = '接管抢占 graceful pause' WHERE id = $3`,
          [JSON.stringify(logs), JSON.stringify({ accountId, reason: 'takeover', pausedAt: new Date().toISOString() }), runId],
        );
        await this.dataSource.getRepository(TaskEntity).update(task.id, {
          status: TaskStatus.Pending, // release 后重新参与调度
          pausedAt: new Date(),
          lastError: null,
        });
        return;
      }
      // M9 · hard-kill · 不计失败, task_run=interrupted, task=pending
      if (err instanceof TaskInterruptedError) {
        this.logger.warn(`task ${task.id} interrupted (hard-kill) on acc ${accountId}`);
        await this.dataSource.query(
          `UPDATE task_run SET logs = $1, finished_at = NOW(), status = 'interrupted', error_code = 'TAKEOVER_HARD_KILL', error_message = $2 WHERE id = $3`,
          [JSON.stringify(logs), err.message, runId],
        );
        await this.dataSource.getRepository(TaskEntity).update(task.id, {
          status: TaskStatus.Pending,
          pausedAt: new Date(),
          lastError: null,
        });
        return;
      }

      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`task ${task.id} executor threw: ${message}`);
      await this.dataSource.query(
        `UPDATE task_run SET logs = $1, finished_at = NOW(), status = 'failed', error_code = 'EXEC_THREW', error_message = $2 WHERE id = $3`,
        [JSON.stringify(logs), message, runId],
      );
      await this.dataSource.getRepository(TaskEntity).update(task.id, {
        status: TaskStatus.Failed,
        lastError: message,
      });
      this.emitRisk({
        accountId,
        code: RiskEventCode.SendFailed,
        severity: 'warn',
        source: 'task_runner',
        sourceRef: `task_run:${runId}`,
        meta: { taskId: task.id, errorCode: 'EXEC_THREW' },
      });
    }
  }

  /**
   * M8 · 发 risk event 到 event bus. 静默失败 (bus 未注入 = M3 spec / 无监听 = 正常).
   */
  private emitRisk(event: RiskRawEvent): void {
    if (!this.eventBus) return;
    try {
      this.eventBus.emit(RISK_EVENT_CHANNEL, event);
    } catch (err) {
      this.logger.debug(`emit risk failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async finishRun(
    runId: number,
    taskId: number,
    status: TaskRunStatus,
    errorCode: string | null,
    errorMessage: string | null,
  ): Promise<void> {
    await this.dataSource
      .getRepository(TaskRunEntity)
      .update(runId, { finishedAt: new Date(), status, errorCode, errorMessage });
    if (status === TaskRunStatus.Failed) {
      await this.dataSource.getRepository(TaskEntity).update(taskId, { status: TaskStatus.Failed, lastError: errorMessage });
    }
  }

  /**
   * 构建一次 tick 的快照 (所有决策读同一份, 避免同轮多任务交叉).
   */
  async buildContext(now: Date, maxConcurrency: number): Promise<DispatchContext> {
    // 跑"running" 的 task_run (finished_at IS NULL) 代表在跑
    const runningRuns = await this.dataSource.getRepository(TaskRunEntity).find({
      where: { status: TaskRunStatus.Running },
      select: ['accountId'],
    });
    const runningAccountIds = new Set<number>();
    for (const r of runningRuns) {
      if (r.accountId !== null) runningAccountIds.add(r.accountId);
    }

    const runningProxyIds = new Set<number>();
    if (runningAccountIds.size > 0) {
      const slots = await this.dataSource.getRepository(AccountSlotEntity).find({
        where: { accountId: In([...runningAccountIds]) },
        select: ['proxyId'],
      });
      for (const s of slots) {
        runningProxyIds.add(s.proxyId ?? -1); // null 归到 "直连组" (-1 占位)
      }
    }

    return {
      now,
      runningAccountIds,
      runningProxyIds,
      runningCount: runningRuns.length,
      maxConcurrency,
    };
  }

  isInNightWindow(now: Date): boolean {
    const start = this.parseHHmm(this.config.get<string>('SCHEDULER_NIGHT_WINDOW_START', '02:00'));
    const end = this.parseHHmm(this.config.get<string>('SCHEDULER_NIGHT_WINDOW_END', '06:00'));
    const mins = now.getHours() * 60 + now.getMinutes();
    if (start <= end) return mins >= start && mins < end;
    // 跨午夜 (start > end) — 22:00 → 04:00
    return mins >= start || mins < end;
  }

  private parseHHmm(s: string): number {
    const [h, m] = s.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }
}
