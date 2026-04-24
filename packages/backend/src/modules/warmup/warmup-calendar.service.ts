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
import { GroupWarmupPlanEntity } from './group-warmup-plan.entity';
import {
  getTemplate,
  MATURE_DAILY_WINDOWS,
  V1_14DAY_TEMPLATE,
  WarmupTaskSpec,
} from './warmup-plan.templates';
import { WarmupPhaseService } from './warmup-phase.service';
import { WarmupPairPicker } from './warmup-pair-picker.service';
import { TaskEntity, TaskStatus, TaskTargetType } from '../tasks/task.entity';
import { AccountSlotEntity } from '../slots/account-slot.entity';
import { ScriptEntity } from '../scripts/script.entity';
import { IsNull } from 'typeorm';
import { ExecutionGroupEntity } from '../execution-groups/execution-group.entity';

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
    private readonly pairPicker: WarmupPairPicker,
    @InjectRepository(WarmupPlanEntity) private readonly planRepo: Repository<WarmupPlanEntity>,
    @InjectRepository(GroupWarmupPlanEntity)
    private readonly groupPlanRepo: Repository<GroupWarmupPlanEntity>,
    @InjectRepository(ExecutionGroupEntity)
    private readonly groupRepo: Repository<ExecutionGroupEntity>,
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
  async tick(now: Date = new Date()): Promise<{ spawned: number; plans: number; groupPlans: number }> {
    // 独立 plan (无 group_plan_id) · 按原逻辑跑
    const plans = await this.planRepo.find({
      where: { paused: false, groupPlanId: IsNull() },
    });
    let spawned = 0;

    for (const plan of plans) {
      try {
        await this.phaseService.maybeRegress(plan, now);
        const lastAdv = plan.lastAdvancedAt ?? plan.startedAt;
        if (lastAdv && now.getTime() - lastAdv.getTime() >= 24 * 3600 * 1000) {
          await this.phaseService.tickDay(plan.id, now);
          const fresh = await this.planRepo.findOne({ where: { id: plan.id } });
          if (fresh) Object.assign(plan, fresh);
        }
        spawned += await this.spawnTodayWindow(plan, now);
      } catch (err) {
        this.logger.error(`plan ${plan.id} tick 失败: ${err instanceof Error ? err.message : err}`);
      }
    }

    // 2026-04-22 · Group 养号计划 · 整组调度 · script_chat 用 pair picker
    const groupPlans = await this.groupPlanRepo.find({ where: { paused: false } });
    for (const gp of groupPlans) {
      try {
        spawned += await this.spawnGroupTodayWindow(gp, now);
      } catch (err) {
        this.logger.error(`group-plan ${gp.id} tick 失败: ${err instanceof Error ? err.message : err}`);
      }
    }

    if (spawned > 0) {
      this.logger.log(
        `warmup calendar tick · solo=${plans.length} group=${groupPlans.length} · ${spawned} tasks spawned`,
      );
    }
    return { spawned, plans: plans.length, groupPlans: groupPlans.length };
  }

  /**
   * 2026-04-22 · Group 计划的窗口调度
   * - warmup/status_browse/status_post: 组内每号各自 enqueue (按该号 per-account plan 已有的 current_day 过滤?)
   *   为简化 · 按 group plan 的 current_day 决定
   * - script_chat: 用 pair picker 挑不重叠 pairs · 每 pair 1 task
   */
  private async spawnGroupTodayWindow(gp: GroupWarmupPlanEntity, now: Date): Promise<number> {
    const template = getTemplate(gp.template) ?? V1_14DAY_TEMPLATE;
    const day = template.days.find((d) => d.day === gp.currentDay);
    const windows = day ? day.windows : gp.currentPhase === WarmupPhase.Mature ? MATURE_DAILY_WINDOWS : [];
    if (windows.length === 0) return 0;

    const group = await this.groupRepo.findOne({
      where: { id: gp.groupId },
      relations: ['slots'],
    });
    if (!group) return 0;
    const members = (group.slots ?? []).filter((s) => s.accountId !== null);
    if (members.length < 2) return 0;

    const nowMs = now.getTime();
    const windowEnd = nowMs + 3600 * 1000;
    let count = 0;

    for (const w of windows) {
      const [hh, mm] = w.at.split(':').map(Number);
      const base = new Date(now);
      base.setHours(hh, mm, 0, 0);
      const jitterMs = (Math.floor(Math.random() * 31) + 15) * 60 * 1000 * (Math.random() < 0.5 ? -1 : 1);
      const scheduledAt = new Date(base.getTime() + jitterMs);
      if (scheduledAt.getTime() < nowMs || scheduledAt.getTime() >= windowEnd) continue;

      for (const spec of w.tasks) {
        // status_post phase gate §B.20
        if (spec.taskType === 'status_post' && gp.currentPhase < WarmupPhase.Activate) continue;

        if (spec.taskType === 'script_chat') {
          // pair picker 挑配对 · 每 pair 1 task
          const memberIds = members.map((m) => m.accountId!) as number[];
          const pairs = this.pairPicker.pickPairs(memberIds, gp.lastPairHistory ?? [], {
            maxPairs: Math.floor(memberIds.length / 2),
          });
          if (pairs.length === 0) continue;
          // 捞 script
          const script = await this.scriptRepo
            .createQueryBuilder('s')
            .where('s.min_warmup_stage <= :stage', { stage: gp.currentPhase })
            .andWhere('s.pack_id IN (SELECT id FROM script_pack WHERE enabled = true)')
            .orderBy('RANDOM()')
            .limit(1)
            .getOne();
          if (!script) continue;
          for (const [aId, bId] of pairs) {
            const dedupeKey = `gp${gp.id}_d${gp.currentDay}_${w.at}_pair${Math.min(aId, bId)}-${Math.max(aId, bId)}`;
            if (await this.isGroupDuplicate(dedupeKey)) continue;
            await this.taskRepo.save(
              this.taskRepo.create({
                tenantId: group.tenantId,
                taskType: 'script_chat',
                targetType: TaskTargetType.Account,
                targetIds: [aId],
                priority: 5,
                scheduledAt,
                repeatRule: null,
                payload: {
                  scriptId: script.id,
                  roleAaccountId: aId,
                  roleBaccountId: bId,
                  _groupPlanId: gp.id,
                  _planDay: gp.currentDay,
                  _windowAt: w.at,
                  _dedupeKey: dedupeKey,
                },
                status: TaskStatus.Pending,
              }),
            );
            count++;
          }
          // 记录历史
          gp.lastPairHistory = this.pairPicker.appendToHistory(
            gp.lastPairHistory ?? [],
            gp.currentDay,
            pairs,
          );
          await this.groupPlanRepo.save(gp);
          continue;
        }

        // 非 script_chat · 组内每号各自 enqueue
        for (const member of members) {
          const dedupeKey = `gp${gp.id}_d${gp.currentDay}_${w.at}_acc${member.accountId}_${spec.taskType}`;
          if (await this.isGroupDuplicate(dedupeKey)) continue;
          await this.taskRepo.save(
            this.taskRepo.create({
              tenantId: group.tenantId,
              taskType: spec.taskType,
              targetType: TaskTargetType.Account,
              targetIds: [member.accountId!],
              priority: 5,
              scheduledAt,
              repeatRule: null,
              payload: {
                ...(spec.payload ?? {}),
                _groupPlanId: gp.id,
                _planDay: gp.currentDay,
                _windowAt: w.at,
                _dedupeKey: dedupeKey,
              },
              status: TaskStatus.Pending,
            }),
          );
          count++;
        }
      }
    }

    // group plan 跨日推进 (简化版 · 不走 phaseService)
    const lastAdv = gp.updatedAt;
    if (lastAdv && now.getTime() - lastAdv.getTime() >= 24 * 3600 * 1000) {
      gp.currentDay = Math.min(gp.currentDay + 1, template.totalDays + 7); // 最多 Day totalDays+7 (进 Mature)
      // phase threshold
      for (const [phase, threshold] of Object.entries(template.phaseThresholds)) {
        if (gp.currentDay >= (threshold as number)) gp.currentPhase = Number(phase);
      }
      await this.groupPlanRepo.save(gp);
    }

    return count;
  }

  private async isGroupDuplicate(dedupeKey: string): Promise<boolean> {
    const qb = this.taskRepo
      .createQueryBuilder('t')
      .where("t.payload ->> '_dedupeKey' = :k", { k: dedupeKey })
      .andWhere('t.status IN (:...statuses)', {
        statuses: [TaskStatus.Pending, TaskStatus.Queued, TaskStatus.Running, TaskStatus.Done],
      });
    return (await qb.getCount()) > 0;
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
