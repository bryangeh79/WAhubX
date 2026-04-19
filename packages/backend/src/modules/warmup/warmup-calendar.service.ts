import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WarmupPlanEntity, WarmupPhase } from './warmup-plan.entity';
import {
  getTemplate,
  MATURE_DAILY_WINDOWS,
  V1_14DAY_TEMPLATE,
  WarmupTaskSpec,
} from './warmup-plan.templates';
import { WarmupPhaseService } from './warmup-phase.service';
import { TaskEntity, TaskStatus, TaskTargetType } from '../tasks/task.entity';
import { AccountSlotEntity } from '../slots/account-slot.entity';
import { ScriptEntity } from '../scripts/script.entity';

// Warmup calendar 引擎.
// 1h setInterval (与 M3 dispatcher 的 setInterval 风格一致, 不引入 BullMQ repeatable — M3 也没用).
// 每次 tick:
//   1. 扫描所有 paused=false 的 plan
//   2. 可能的 regress (health → Phase 0)
//   3. 跨天推进 (上次 tick 是昨天了? bump current_day + 可能 advance phase)
//   4. 读今日 schedule — 找到 [now, now+1h) 窗口内所有 WarmupTaskSpec
//   5. 给每个 spec 创建 task (带 ±15-30min jitter 的 scheduled_at, 对齐 §B.2)
//   6. 已创建的跳过 (幂等: payload 带 plan_day + window_at 去重)
@Injectable()
export class WarmupCalendarService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WarmupCalendarService.name);
  private tickTimer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private readonly config: ConfigService,
    private readonly phaseService: WarmupPhaseService,
    @InjectRepository(WarmupPlanEntity) private readonly planRepo: Repository<WarmupPlanEntity>,
    @InjectRepository(TaskEntity) private readonly taskRepo: Repository<TaskEntity>,
    @InjectRepository(AccountSlotEntity) private readonly slotRepo: Repository<AccountSlotEntity>,
    @InjectRepository(ScriptEntity) private readonly scriptRepo: Repository<ScriptEntity>,
  ) {}

  onModuleInit(): void {
    // 允许 env 关 (test / smoke 快速跑不用 hourly tick)
    if (this.config.get<string>('WARMUP_CALENDAR_ENABLED', 'true') === 'false') {
      this.logger.warn('warmup calendar disabled via WARMUP_CALENDAR_ENABLED=false');
      return;
    }
    const intervalMs = Number(this.config.get<string>('WARMUP_CALENDAR_INTERVAL_MS', '3600000'));
    this.tickTimer = setInterval(() => {
      if (this.busy) return;
      this.busy = true;
      this.tick()
        .catch((err) => this.logger.error(`warmup calendar tick error: ${err}`))
        .finally(() => (this.busy = false));
    }, intervalMs);
    this.logger.log(`warmup calendar enabled · tick every ${intervalMs / 1000}s`);
  }

  onModuleDestroy(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
  }

  /**
   * 主 tick 函数. 公开接口方便手动触发/测试.
   */
  async tick(now: Date = new Date()): Promise<{ spawned: number; plans: number }> {
    const plans = await this.planRepo.find({ where: { paused: false } });
    let spawned = 0;

    for (const plan of plans) {
      try {
        // 先 regress check (health=high → Phase 0)
        await this.phaseService.maybeRegress(plan, now);

        // 跨日推进 (上次 advance 超 24h 就 + 1)
        const lastAdv = plan.lastAdvancedAt ?? plan.startedAt;
        if (lastAdv && now.getTime() - lastAdv.getTime() >= 24 * 3600 * 1000) {
          await this.phaseService.tickDay(plan.id, now);
          // 重读, phase/day 已变
          const fresh = await this.planRepo.findOne({ where: { id: plan.id } });
          if (fresh) Object.assign(plan, fresh);
        }

        spawned += await this.spawnTodayWindow(plan, now);
      } catch (err) {
        this.logger.error(`plan ${plan.id} tick 失败: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (spawned > 0) {
      this.logger.log(`warmup calendar tick · ${plans.length} plans · ${spawned} tasks spawned`);
    }
    return { spawned, plans: plans.length };
  }

  /**
   * 取 plan 当日 schedule, 找落入 [now, now+1h) 的 window, 创建 task (幂等).
   */
  private async spawnTodayWindow(plan: WarmupPlanEntity, now: Date): Promise<number> {
    const template = getTemplate(plan.template) ?? V1_14DAY_TEMPLATE;
    const day = template.days.find((d) => d.day === plan.currentDay);

    // Phase 3 (Mature) · Day > 14 → 用 MATURE_DAILY_WINDOWS
    const windows = day ? day.windows : plan.currentPhase === WarmupPhase.Mature ? MATURE_DAILY_WINDOWS : [];

    const slot = await this.slotRepo.findOne({ where: { accountId: plan.accountId } });
    if (!slot) return 0;

    let count = 0;
    const nowMs = now.getTime();
    const windowEnd = nowMs + 3600 * 1000; // 下一 h 内

    for (const w of windows) {
      const [hh, mm] = w.at.split(':').map(Number);
      const scheduledBase = new Date(now);
      scheduledBase.setHours(hh, mm, 0, 0);
      // jitter ±15-30min 随机 (§B.2)
      const jitterMs = (Math.floor(Math.random() * 31) + 15) * 60 * 1000 * (Math.random() < 0.5 ? -1 : 1);
      const scheduledAt = new Date(scheduledBase.getTime() + jitterMs);
      if (scheduledAt.getTime() < nowMs || scheduledAt.getTime() >= windowEnd) continue;

      for (const spec of w.tasks) {
        // status_post phase gate §B.20 · M5 严守: Phase 0-1 禁止
        if (spec.taskType === 'status_post' && plan.currentPhase < WarmupPhase.Activate) continue;
        if (await this.isDuplicate(plan, w.at, spec.taskType)) continue;
        const payload = await this.resolvePayload(plan, spec, slot);
        if (payload === null) continue; // pair 不可得 / script 无 eligible

        await this.taskRepo.save(
          this.taskRepo.create({
            tenantId: slot.tenantId,
            taskType: spec.taskType,
            targetType: TaskTargetType.Account,
            targetIds: [plan.accountId],
            priority: 5,
            scheduledAt,
            repeatRule: null,
            payload: {
              ...payload,
              _warmupPlanId: plan.id,
              _planDay: plan.currentDay,
              _windowAt: w.at,
              _durationMin: w.durationMin,
            },
            status: TaskStatus.Pending,
          }),
        );
        count++;
      }
    }
    return count;
  }

  /**
   * 幂等: 同 plan · 同 day · 同 window_at · 同 taskType 已有 pending/queued/running 就跳过.
   */
  private async isDuplicate(
    plan: WarmupPlanEntity,
    windowAt: string,
    taskType: string,
  ): Promise<boolean> {
    const qb = this.taskRepo
      .createQueryBuilder('t')
      .where('t.payload ->> \'_warmupPlanId\' = :pid', { pid: String(plan.id) })
      .andWhere('t.payload ->> \'_planDay\' = :day', { day: String(plan.currentDay) })
      .andWhere('t.payload ->> \'_windowAt\' = :wat', { wat: windowAt })
      .andWhere('t.task_type = :tt', { tt: taskType })
      .andWhere('t.status IN (:...statuses)', {
        statuses: [TaskStatus.Pending, TaskStatus.Queued, TaskStatus.Running, TaskStatus.Done],
      });
    const n = await qb.getCount();
    return n > 0;
  }

  /**
   * 给 spec 补 payload.
   *   - warmup / status_browse: {} 直接跑
   *   - status_post: payload 里不决定素材 (executor 运行时 4 层降级)
   *   - script_chat: 运行时由 dispatcher 执行. 这里不挑 partner, 让 executor 现查 pair (保时效).
   *                  预检 eligible script 存在, 否则返 null (skip)
   */
  private async resolvePayload(
    plan: WarmupPlanEntity,
    spec: WarmupTaskSpec,
    _slot: AccountSlotEntity,
  ): Promise<Record<string, unknown> | null> {
    if (spec.taskType === 'warmup' || spec.taskType === 'status_browse' || spec.taskType === 'status_post') {
      return { ...(spec.payload ?? {}) };
    }
    if (spec.taskType === 'script_chat') {
      // 挑一个 min_warmup_stage ≤ current_phase 的 script
      const candidates = await this.scriptRepo
        .createQueryBuilder('s')
        .where('s.min_warmup_stage <= :stage', { stage: plan.currentPhase })
        .andWhere('s.pack_id IN (SELECT id FROM script_pack WHERE enabled = true)')
        .orderBy('RANDOM()')
        .limit(1)
        .getOne();
      if (!candidates) return null;
      return {
        scriptId: candidates.id,
        roleAaccountId: plan.accountId,
        // roleBaccountId 由 executor 现查 (pair service), payload 里不硬编码
        _needPair: true,
      };
    }
    return null;
  }
}
