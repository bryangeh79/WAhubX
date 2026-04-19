import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RISK_EVENT_CHANNEL, type RiskRawEvent } from './risk.events';
import { RiskEventService } from './risk-event.service';
import { HealthScorerService } from './health-scorer.service';
import { HealthSettingsService } from './health-settings.service';
import { AlertDispatcherService } from './alert-dispatcher.service';
import { WarmupPhaseService } from '../warmup/warmup-phase.service';
import { WarmupPlanEntity } from '../warmup/warmup-plan.entity';
import { RiskLevel } from '../slots/account-health.entity';

// 协调器 · 把 risk event → 持久化 → rescore → debounce 30min → regress / alert 串起来
//
// 双 tick 架构:
//   1. event 触发: OnEvent('risk.raw') → record → rescore (同步响应)
//   2. 5min setInterval 兜底 rescore (处理 missed events / 持续观察)
// Debounce: risk_level=high 连续 >= 30min 才触发 auto-regress (§用户 2026-04-20 C)
//   内存状态机 Map<accountId, { firstHighAt }> · 进程重启清空 (降级要信号, 别过分记忆)
@Injectable()
export class HealthCoordinatorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HealthCoordinatorService.name);
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  // debounce 状态: 账号首次进 high 的时间. 离开 high 时清除.
  private readonly highSince = new Map<number, Date>();
  private readonly REGRESS_DEBOUNCE_MS = 30 * 60 * 1000;

  constructor(
    private readonly events: RiskEventService,
    private readonly scorer: HealthScorerService,
    private readonly settings: HealthSettingsService,
    private readonly alerts: AlertDispatcherService,
    private readonly phaseService: WarmupPhaseService,
    @InjectRepository(WarmupPlanEntity) private readonly planRepo: Repository<WarmupPlanEntity>,
  ) {}

  onModuleInit(): void {
    const intervalMs = Number(process.env.HEALTH_RESCORE_INTERVAL_MS ?? 5 * 60 * 1000);
    this.timer = setInterval(() => {
      if (this.busy) return;
      this.busy = true;
      this.periodicRescore()
        .catch((err) => this.logger.error(`periodic rescore error: ${err}`))
        .finally(() => (this.busy = false));
    }, intervalMs);
    this.logger.log(`health coordinator enabled · rescore every ${intervalMs / 1000}s · debounce ${this.REGRESS_DEBOUNCE_MS / 60000}min`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  @OnEvent(RISK_EVENT_CHANNEL, { async: true })
  async handleRaw(event: RiskRawEvent): Promise<void> {
    try {
      const { inserted } = await this.events.record(event);
      if (!inserted) return; // 去重击中, 分数不用变
      const result = await this.scorer.rescore(event.accountId);
      await this.handleScoreTransition(result.accountId, result.riskLevel);
    } catch (err) {
      this.logger.error(
        `handle risk event failed · acc=${event.accountId} code=${event.code}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * 5min 兜底 rescore — 扫所有绑定 account 的 plan, 重算. 吃漏掉的 event 变化 +
   * debounce 窗口内"高分持续时间"需要定期检查 (非立即到期).
   */
  async periodicRescore(): Promise<void> {
    const plans = await this.planRepo.find({});
    for (const plan of plans) {
      try {
        const result = await this.scorer.rescore(plan.accountId);
        await this.handleScoreTransition(result.accountId, result.riskLevel);
      } catch (err) {
        this.logger.debug(
          `periodic rescore skip acc=${plan.accountId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  /**
   * 核心降级触发逻辑. dry_run 影响行为, 不影响 risk_level 落盘.
   */
  private async handleScoreTransition(accountId: number, level: RiskLevel): Promise<void> {
    const dryRun = await this.settings.isDryRun();

    if (level !== RiskLevel.High) {
      // 退出 high → 清 debounce 时钟
      if (this.highSince.delete(accountId)) {
        this.logger.log(`acc=${accountId} exited high · debounce cleared`);
      }
      return;
    }

    // 进 high
    if (!this.highSince.has(accountId)) {
      this.highSince.set(accountId, new Date());
      await this.alerts.dispatch({
        title: `账号 ${accountId} 风险升高`,
        message: dryRun
          ? `槽位将在 30min 后降级为 high (dry-run 下不真触发)`
          : `进入 high 风险级别, 若持续 30min 将自动回退至 Phase 0 冷却`,
        severity: 'warn',
        type: 'health_drop',
        accountId,
        dryRun,
      });
      return;
    }

    // 已在 high · 检查 debounce 是否到期
    const sinceMs = Date.now() - this.highSince.get(accountId)!.getTime();
    if (sinceMs < this.REGRESS_DEBOUNCE_MS) return;

    // 到期触发 regress
    if (dryRun) {
      this.logger.warn(
        `[DRY-RUN] acc=${accountId} 持续 high ${(sinceMs / 60000).toFixed(0)}min 本应触发 Phase 0 回退, dry_run 不真执行`,
      );
      await this.alerts.dispatch({
        title: `账号 ${accountId} 本应降级`,
        message: `持续 high 超过 30min · dry_run 模式不真回退养号阶段`,
        severity: 'critical',
        type: 'health_drop',
        accountId,
        dryRun: true,
      });
      return;
    }

    const plan = await this.planRepo.findOne({ where: { accountId } });
    if (!plan) return;
    try {
      const regressed = await this.phaseService.maybeRegress(plan);
      if (regressed) {
        this.highSince.delete(accountId);
        await this.alerts.dispatch({
          title: `账号 ${accountId} 已回退 Phase 0`,
          message: `持续高风险超过 30min · 已强制回退养号阶段 + 主动任务暂停`,
          severity: 'critical',
          type: 'banned',
          accountId,
        });
      }
    } catch (err) {
      this.logger.error(
        `regress failed acc=${accountId}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
