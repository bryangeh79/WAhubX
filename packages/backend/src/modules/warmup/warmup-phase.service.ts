import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WarmupPlanEntity, WarmupHistoryEvent, WarmupPhase } from './warmup-plan.entity';
import { WaAccountEntity, WarmupStage } from '../slots/wa-account.entity';
import { AccountHealthEntity, RiskLevel } from '../slots/account-health.entity';
import { getTemplate } from './warmup-plan.templates';

// Phase 机 · §5.3
//   advance: current_day >= phase_threshold → bump phase + log
//   regress: account_health.risk_level = high → 强制回 Phase 0 + 冷却重置 current_day=1
//   skip-to-next: 手动跳下一 phase, 记 reason, 日志 'skip'
// 所有变更都落 history 事件流
@Injectable()
export class WarmupPhaseService {
  private readonly logger = new Logger(WarmupPhaseService.name);

  constructor(
    @InjectRepository(WarmupPlanEntity) private readonly planRepo: Repository<WarmupPlanEntity>,
    @InjectRepository(WaAccountEntity) private readonly accountRepo: Repository<WaAccountEntity>,
    @InjectRepository(AccountHealthEntity) private readonly healthRepo: Repository<AccountHealthEntity>,
  ) {}

  /**
   * 日 tick: current_day + 1, 检查是否跨阈值升 phase. 也检查 health → regress.
   * 返回变更后的 plan (便于 calendar 继续读今日 schedule).
   */
  async tickDay(planId: number, now: Date = new Date()): Promise<WarmupPlanEntity> {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new Error(`warmup plan ${planId} 不存在`);

    // 先 check regress (健康分决定), 再推 day
    const regressed = await this.maybeRegress(plan, now);
    if (regressed) return plan;

    if (plan.paused) return plan; // 暂停不推

    plan.currentDay += 1;
    const template = getTemplate(plan.template);
    if (!template) {
      this.logger.warn(`plan ${plan.id} template ${plan.template} 不存在, 保当前状态`);
      return plan;
    }

    const nextPhase = this.computePhaseForDay(plan.currentDay, template.phaseThresholds);
    if (nextPhase > plan.currentPhase) {
      const from = plan.currentPhase;
      plan.currentPhase = nextPhase;
      plan.lastAdvancedAt = now;
      this.pushHistory(plan, {
        at: now.toISOString(),
        event: 'advance',
        fromPhase: from,
        toPhase: nextPhase,
        fromDay: plan.currentDay - 1,
        toDay: plan.currentDay,
      });
      // 同步更新 wa_account.warmup_stage (给 script gate 读) — 枚举跨类型对齐 (值相同)
      await this.accountRepo.update({ id: plan.accountId }, { warmupStage: nextPhase as unknown as WarmupStage });
      this.logger.log(`plan ${plan.id} advance ${from}→${nextPhase} @ day ${plan.currentDay}`);
    }
    await this.accountRepo.update({ id: plan.accountId }, { warmupDay: plan.currentDay });
    return this.planRepo.save(plan);
  }

  /**
   * 检查 health.risk_level = high → 强制 Phase 0 + day=1 + 记 regress_reason
   * 技术交接文档 § 5.3: "被封/掉线 → 退回 Phase 0" · § 5.4: "high 0-29 暂停主动任务"
   */
  async maybeRegress(plan: WarmupPlanEntity, now: Date = new Date()): Promise<boolean> {
    if (plan.currentPhase === WarmupPhase.Incubate && plan.currentDay <= 1) return false; // 已在底
    const health = await this.healthRepo.findOne({ where: { accountId: plan.accountId } });
    if (!health) return false; // M1 建账号时不保 health 存在, 无 row 视为 low
    if (health.riskLevel !== RiskLevel.High) return false;

    const from = plan.currentPhase;
    const fromDay = plan.currentDay;
    plan.currentPhase = WarmupPhase.Incubate;
    plan.currentDay = 1;
    plan.regressedAt = now;
    plan.regressReason = `risk_level=high · score=${health.healthScore}`;
    this.pushHistory(plan, {
      at: now.toISOString(),
      event: 'regress',
      fromPhase: from,
      toPhase: WarmupPhase.Incubate,
      fromDay,
      toDay: 1,
      reason: plan.regressReason,
    });
    await this.accountRepo.update({ id: plan.accountId }, {
      warmupStage: WarmupStage.Incubation,
      warmupDay: 1,
    });
    await this.planRepo.save(plan);
    this.logger.warn(`plan ${plan.id} REGRESS ${from}→0 · ${plan.regressReason}`);
    return true;
  }

  /**
   * M8 coordinator 便捷入口: 直接按 accountId 触发 regress 检查.
   * 内部重用 maybeRegress, 但 plan 找不到时返 false 而不抛.
   */
  async maybeRegressByAccountId(accountId: number, now: Date = new Date()): Promise<boolean> {
    const plan = await this.planRepo.findOne({ where: { accountId } });
    if (!plan) return false;
    return this.maybeRegress(plan, now);
  }

  /**
   * 手动跳下一 phase (expert mode). 只允许往前, 不允许回退 (回退走 regress).
   */
  async skipToNextPhase(planId: number, reason: string): Promise<WarmupPlanEntity> {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new Error(`plan ${planId} 不存在`);
    if (plan.currentPhase >= WarmupPhase.Mature) {
      throw new Error('已在 Mature phase, 无法再升');
    }
    const template = getTemplate(plan.template);
    if (!template) throw new Error(`template ${plan.template} 不存在`);

    const from = plan.currentPhase;
    const to = (from + 1) as WarmupPhase;
    plan.currentPhase = to;
    // 把 day 推到目标 phase 的起始日, 避免日历 windows 错位
    plan.currentDay = template.phaseThresholds[to];
    plan.lastAdvancedAt = new Date();
    this.pushHistory(plan, {
      at: plan.lastAdvancedAt.toISOString(),
      event: 'skip',
      fromPhase: from,
      toPhase: to,
      reason,
    });
    await this.accountRepo.update({ id: plan.accountId }, {
      warmupStage: to as unknown as WarmupStage,
      warmupDay: plan.currentDay,
    });
    this.logger.log(`plan ${plan.id} SKIP ${from}→${to} · ${reason}`);
    return this.planRepo.save(plan);
  }

  async pause(planId: number, reason: string): Promise<WarmupPlanEntity> {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new Error(`plan ${planId} 不存在`);
    plan.paused = true;
    this.pushHistory(plan, { at: new Date().toISOString(), event: 'pause', reason });
    return this.planRepo.save(plan);
  }

  async resume(planId: number): Promise<WarmupPlanEntity> {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) throw new Error(`plan ${planId} 不存在`);
    plan.paused = false;
    this.pushHistory(plan, { at: new Date().toISOString(), event: 'resume' });
    return this.planRepo.save(plan);
  }

  // ── 纯函数: 按 day 算当前 phase (方便单测) ──────────────────
  computePhaseForDay(day: number, thresholds: Record<WarmupPhase, number>): WarmupPhase {
    if (day >= thresholds[WarmupPhase.Mature]) return WarmupPhase.Mature;
    if (day >= thresholds[WarmupPhase.Activate]) return WarmupPhase.Activate;
    if (day >= thresholds[WarmupPhase.Preheat]) return WarmupPhase.Preheat;
    return WarmupPhase.Incubate;
  }

  private pushHistory(plan: WarmupPlanEntity, evt: WarmupHistoryEvent): void {
    const arr = Array.isArray(plan.history) ? plan.history : [];
    arr.push(evt);
    plan.history = arr.slice(-100); // 最多保 100 条, 防 JSONB 膨胀
  }
}
