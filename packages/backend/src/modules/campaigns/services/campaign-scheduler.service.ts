import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  AdStrategy,
  CampaignEntity,
  CampaignStatus,
  ExecutionMode,
  OpeningStrategy,
} from '../entities/campaign.entity';
import { CampaignRunEntity, CampaignRunStatus } from '../entities/campaign-run.entity';
import {
  CampaignTargetEntity,
  CampaignTargetStatus,
} from '../entities/campaign-target.entity';
import { TaskEntity, TaskStatus, TaskTargetType } from '../../tasks/task.entity';
import { CustomerGroupsService } from './customer-groups.service';
import { MatureSlotPickerService, MatureSlot } from './mature-slot-picker.service';
import { ThrottleProfileService } from './throttle-profile.service';
import { CampaignExpanderService } from './campaign-expander.service';
import { normalizePhone } from '../utils/phone';

// 2026-04-23 · 广告投放调度器 · plan §B "Campaign Scheduler @Cron"
//
// 每分钟 tick:
//   1. feature flag 开? 否 return
//   2. 每日补展 daily/weekly 任务
//   3. 取 pending 的 campaign_run WHERE fire_at <= now
//      - 对应 campaign 是否 Running · 否则 skip
//   4. 标 run.status=Running, 展开 target, 分配 slot, 写 task 行
//   5. dispatcher 原逻辑自然捡 task_type='send_ad'
//
// 设计决定: 用 setInterval 不用 @nestjs/schedule (项目没装 ScheduleModule, 引入依赖会改现有配置)

const TICK_INTERVAL_MS = 60_000;

@Injectable()
export class CampaignSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CampaignSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    @InjectRepository(CampaignEntity) private readonly campaignRepo: Repository<CampaignEntity>,
    @InjectRepository(CampaignRunEntity) private readonly runRepo: Repository<CampaignRunEntity>,
    @InjectRepository(CampaignTargetEntity) private readonly targetRepo: Repository<CampaignTargetEntity>,
    @InjectRepository(TaskEntity) private readonly taskRepo: Repository<TaskEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly groups: CustomerGroupsService,
    private readonly matureSlots: MatureSlotPickerService,
    private readonly throttle: ThrottleProfileService,
    private readonly expander: CampaignExpanderService,
  ) {}

  onModuleInit(): void {
    // 延迟 30s 再开 tick, 让其他模块先就绪
    setTimeout(() => {
      this.tick().catch((e) => this.logger.error(`initial tick failed: ${e}`));
      this.timer = setInterval(() => {
        this.tick().catch((e) => this.logger.error(`tick failed: ${e}`));
      }, TICK_INTERVAL_MS);
    }, 30_000);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const enabled = await this.throttle.isModuleEnabled();
      if (!enabled) return;

      await this.rolloverExpansion();
      await this.firePendingRuns();
    } finally {
      this.busy = false;
    }
  }

  /**
   * 对所有 Running 的 campaign 补展 (daily/weekly 滚动 horizon 外的)
   */
  private async rolloverExpansion(): Promise<void> {
    const running = await this.campaignRepo.find({ where: { status: CampaignStatus.Running } });
    for (const c of running) {
      if (c.schedule.mode === 'immediate' || c.schedule.mode === 'once') continue;
      try {
        await this.expander.expand(c);
      } catch (err) {
        this.logger.warn(`rollover expand failed · campaign=${c.id}: ${err}`);
      }
    }
  }

  /**
   * 取 fire_at <= now 的 pending run, 展开 target
   */
  private async firePendingRuns(): Promise<void> {
    const now = new Date();
    const runs = await this.runRepo
      .createQueryBuilder('r')
      .where('r.status = :st', { st: CampaignRunStatus.Pending })
      .andWhere('r.fire_at <= :now', { now })
      .orderBy('r.fire_at', 'ASC')
      .take(10)
      .getMany();

    for (const run of runs) {
      try {
        await this.fireOne(run, now);
      } catch (err) {
        this.logger.error(`fire run ${run.id} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  private async fireOne(run: CampaignRunEntity, now: Date): Promise<void> {
    const campaign = await this.campaignRepo.findOne({ where: { id: run.campaignId } });
    if (!campaign) {
      await this.runRepo.update(run.id, { status: CampaignRunStatus.Cancelled, finishedAt: now });
      return;
    }
    if (campaign.status !== CampaignStatus.Running) {
      // 暂停或取消的 campaign → run 跟着取消
      await this.runRepo.update(run.id, { status: CampaignRunStatus.Cancelled, finishedAt: now });
      return;
    }

    // 标 running
    await this.runRepo.update(run.id, { status: CampaignRunStatus.Running, startedAt: now });

    // 1. 目标号码清单 (去重)
    const phones = await this.collectPhones(campaign);
    if (phones.length === 0) {
      await this.runRepo.update(run.id, {
        status: CampaignRunStatus.Done,
        finishedAt: new Date(),
        stats: { planned: 0, sent: 0, failed: 0, skipped: 0 },
      });
      this.logger.warn(`campaign ${campaign.id} run ${run.id} · 0 targets · skipped`);
      return;
    }

    // 2. 获取可用号
    //   - 智能模式: 只成熟号
    //   - 自定义模式: 租户勾选的 (含未成熟号 · 租户自担风险)
    let eligibleSlots: MatureSlot[];
    if (campaign.executionMode === ExecutionMode.CustomSlots) {
      const selected = await this.matureSlots.findSlotsIn(campaign.tenantId, campaign.customSlotIds);
      eligibleSlots = selected.map((s) => ({
        slotId: s.slotId,
        slotIndex: s.slotIndex,
        accountId: s.accountId,
        proxyId: s.proxyId,
      }));
    } else {
      eligibleSlots = await this.matureSlots.findMatureSlots(campaign.tenantId);
    }
    if (eligibleSlots.length === 0) {
      await this.runRepo.update(run.id, {
        status: CampaignRunStatus.Cancelled,
        finishedAt: new Date(),
        stats: { planned: phones.length, sent: 0, failed: 0, skipped: phones.length },
      });
      this.logger.warn(`campaign ${campaign.id} run ${run.id} · 0 eligible slots · cancelled`);
      return;
    }

    // 3. 获取节流参数 + 各 slot 今日已发数
    const throttleParams = await this.throttle.get(campaign.throttleProfile);
    const slotCapacity = new Map<number, number>(); // slotId → remaining today
    for (const s of eligibleSlots) {
      const already = await this.matureSlots.countTodaySent(s.slotId, now);
      slotCapacity.set(s.slotId, Math.max(0, throttleParams.dailyCap - already));
    }

    // 2026-04-28 · 立即开始 mode = 用户期望马上发 · 不打散不等节流时段窗口
    // schedule.mode='immediate': 全部 target 用同 NOW · 第一个立即, 后续被 dispatcher 6 并发限流
    // 其他 mode: 走老的 nextSendTime 节流打散
    const isImmediateMode = (campaign.schedule as { mode?: string })?.mode === 'immediate';

    // 4. round-robin 分配 + 时段打散 (immediate mode 跳打散)
    const targets: CampaignTargetEntity[] = [];
    const tasks: TaskEntity[] = [];
    let skipped = 0;
    let slotIdx = 0;

    for (const phone of phones) {
      // 找下一个还有额度的 slot
      let tried = 0;
      let slotId: number | null = null;
      while (tried < eligibleSlots.length) {
        const candidate = eligibleSlots[slotIdx % eligibleSlots.length];
        slotIdx++;
        tried++;
        const remain = slotCapacity.get(candidate.slotId) ?? 0;
        if (remain > 0) {
          slotId = candidate.slotId;
          slotCapacity.set(candidate.slotId, remain - 1);
          break;
        }
      }
      if (slotId === null) {
        // 所有 slot 今日额度满
        skipped++;
        continue;
      }

      // 时段打散: 从 now 起, 每个目标推 gap_sec[0]..gap_sec[1] 的随机秒, 尊重 throttle windows
      // immediate mode: 全部 NOW · 让 dispatcher 调度 (并发 6 + per-account 互斥兜底)
      const scheduledAt = isImmediateMode
        ? now
        : this.nextSendTime(now, throttleParams.windows, throttleParams.gapSec, targets.length);

      // 选广告
      const adId =
        campaign.adStrategy === AdStrategy.Single
          ? campaign.adIds[0]
          : campaign.adIds[Math.floor(Math.random() * campaign.adIds.length)];

      // 选开场白
      let openingId: number | null = null;
      if (campaign.openingStrategy === OpeningStrategy.Fixed && campaign.openingIds.length > 0) {
        openingId = campaign.openingIds[0];
      } else if (campaign.openingStrategy === OpeningStrategy.Random && campaign.openingIds.length > 0) {
        openingId = campaign.openingIds[Math.floor(Math.random() * campaign.openingIds.length)];
      }

      // 查 accountId for slot
      const slot = eligibleSlots.find((s) => s.slotId === slotId)!;

      const target = this.targetRepo.create({
        runId: run.id,
        campaignId: campaign.id,
        phoneE164: phone,
        contactId: null,
        assignedSlotId: slotId,
        adId,
        openingId,
        taskId: null,
        status: CampaignTargetStatus.Pending,
      });
      targets.push(target);

      const task = this.taskRepo.create({
        tenantId: campaign.tenantId,
        taskType: 'send_ad',
        priority: 5,
        scheduledAt,
        repeatRule: null,
        targetType: TaskTargetType.Account,
        targetIds: [slot.accountId],
        payload: {
          // campaignTargetId 在 target.save 后填入
          campaignId: campaign.id,
          runId: run.id,
          phone,
          adId,
          openingId,
          // 立即开始 mode · 标 forceRun · dispatcher 跳过 night-window 检查
          ...(isImmediateMode ? { forceRun: true } : {}),
        },
        status: TaskStatus.Pending,
        lastError: null,
        pausedAt: null,
      });
      tasks.push(task);
    }

    if (targets.length === 0) {
      await this.runRepo.update(run.id, {
        status: CampaignRunStatus.Done,
        finishedAt: new Date(),
        stats: { planned: phones.length, sent: 0, failed: 0, skipped: phones.length },
      });
      return;
    }

    // 事务批量插入 targets 和 tasks, 并关联
    await this.dataSource.transaction(async (manager) => {
      const savedTargets = await manager.save(targets);
      for (let i = 0; i < savedTargets.length; i++) {
        const tgt = savedTargets[i];
        const tsk = tasks[i];
        tsk.payload = { ...(tsk.payload ?? {}), campaignTargetId: tgt.id };
      }
      const savedTasks = await manager.save(tasks);
      for (let i = 0; i < savedTargets.length; i++) {
        savedTargets[i].taskId = savedTasks[i].id;
        savedTargets[i].status = CampaignTargetStatus.Dispatched;
      }
      await manager.save(savedTargets);
    });

    await this.runRepo.update(run.id, {
      stats: { planned: phones.length, sent: 0, failed: 0, skipped },
    });
    this.logger.log(
      `campaign ${campaign.id} run ${run.id} fired · ${targets.length} targets dispatched · ${skipped} skipped (cap)`,
    );
  }

  /**
   * 收集 campaign 的完整目标号码 (去重: group members ∪ extraPhones)
   */
  private async collectPhones(campaign: CampaignEntity): Promise<string[]> {
    const phones = new Set<string>();
    const extra = campaign.targets.extraPhones ?? [];
    for (const p of extra) {
      const n = normalizePhone(p);
      if (n) phones.add(n);
    }
    const groupIds = campaign.targets.groupIds ?? [];
    if (groupIds.length > 0) {
      const fromGroups = await this.groups.fetchMemberPhones(campaign.tenantId, groupIds);
      for (const p of fromGroups) phones.add(p);
    }
    return [...phones];
  }

  /**
   * 给第 n 个目标找发送时间 · 尊重 throttle windows
   */
  private nextSendTime(
    baseline: Date,
    windows: Array<{ start: string; end: string }>,
    gapSec: [number, number],
    index: number,
  ): Date {
    // 累加随机 gap · index=0 从 baseline 起
    const [gMin, gMax] = gapSec;
    const offsetSec = (gMin + (gMax - gMin) * Math.random()) * (index + 1);
    let t = new Date(baseline.getTime() + offsetSec * 1000);

    // 若不在 windows 内, 推到下一个窗口起点
    if (!this.throttle.isWithinWindows(t, windows)) {
      t = this.throttle.nextWindowStart(t, windows);
    }
    return t;
  }
}
