import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AdStrategy,
  CampaignEntity,
  CampaignStatus,
  ExecutionMode,
  OpeningStrategy,
  SafetyStatus,
  ThrottleProfile,
} from '../entities/campaign.entity';
import { CampaignRunEntity, CampaignRunStatus } from '../entities/campaign-run.entity';
import { CampaignTargetEntity } from '../entities/campaign-target.entity';
import { CreateCampaignDto, PreviewSafetyDto, UpdateCampaignDto } from '../dto/campaign.dto';
import { SafetyCapacityService } from './safety-capacity.service';
import { CampaignExpanderService } from './campaign-expander.service';
import { AdvertisementsService } from './advertisements.service';
import { OpeningLinesService } from './opening-lines.service';

// 2026-04-24 · 投放结果报告结构 · plan §I
export interface CampaignReport {
  campaignId: number;
  campaignName: string;
  status: CampaignStatus;
  overall: {
    planned: number;
    sent: number;
    failed: number;
    skipped: number;
    doneCount: number;
    successRate: number; // %, 1 位小数
    replied: number; // 首次回复的 target 数
    totalReplies: number; // 累计回复消息数 (可能 > replied)
    replyRate: number; // replied / sent, %
  };
  timing: {
    firstSent: Date | null;
    lastSent: Date | null;
    durationMs: number;
  };
  slotPerformance: Array<{
    slotId: number;
    slotIndex: number;
    phoneNumber: string | null;
    assigned: number;
    sent: number;
    failed: number;
    successRate: number;
  }>;
  adPerformance: Array<{
    adId: number | null;
    adName: string;
    used: number;
    sent: number;
    failed: number;
    successRate: number;
  }>;
  errorBreakdown: Array<{
    code: string;
    count: number;
    sampleMsg: string | null;
  }>;
  hourlyDistribution: Array<{
    hour: number;
    count: number;
  }>;
}

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    @InjectRepository(CampaignEntity)
    private readonly campaignRepo: Repository<CampaignEntity>,
    @InjectRepository(CampaignRunEntity)
    private readonly runRepo: Repository<CampaignRunEntity>,
    @InjectRepository(CampaignTargetEntity)
    private readonly targetRepo: Repository<CampaignTargetEntity>,
    private readonly safety: SafetyCapacityService,
    private readonly expander: CampaignExpanderService,
    private readonly ads: AdvertisementsService,
    private readonly openings: OpeningLinesService,
  ) {}

  // ──────────────────────────────────────────────────────────────
  // Query
  // ──────────────────────────────────────────────────────────────

  async list(tenantId: number, status?: CampaignStatus) {
    const qb = this.campaignRepo
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId });
    if (status !== undefined) qb.andWhere('c.status = :status', { status });
    return qb.orderBy('c.created_at', 'DESC').getMany();
  }

  async findById(tenantId: number, id: number): Promise<CampaignEntity> {
    const row = await this.campaignRepo.findOne({ where: { tenantId, id } });
    if (!row) throw new NotFoundException(`投放任务 ${id} 不存在`);
    return row;
  }

  async listRuns(tenantId: number, campaignId: number): Promise<CampaignRunEntity[]> {
    await this.findById(tenantId, campaignId);
    const runs = await this.runRepo.find({ where: { campaignId }, order: { fireAt: 'ASC' } });
    if (runs.length === 0) return runs;

    // 2026-04-24 · 实时聚合 campaign_target → run.stats
    // 之前 stats 只在 fire 时写一次, 永远停 0/0/0. 现在每次 listRuns 查一遍实际状态覆盖.
    const runIds = runs.map((r) => r.id);
    const agg = await this.targetRepo
      .createQueryBuilder('t')
      .select('t.run_id', 'runId')
      .addSelect('COUNT(*)', 'planned')
      .addSelect('SUM(CASE WHEN t.status = 2 THEN 1 ELSE 0 END)', 'sent')
      .addSelect('SUM(CASE WHEN t.status = 3 THEN 1 ELSE 0 END)', 'failed')
      .addSelect('SUM(CASE WHEN t.status = 4 THEN 1 ELSE 0 END)', 'skipped')
      .addSelect('SUM(CASE WHEN t.status IN (0, 1) THEN 1 ELSE 0 END)', 'pending')
      .where('t.run_id IN (:...ids)', { ids: runIds })
      .groupBy('t.run_id')
      .getRawMany<{
        runId: string;
        planned: string;
        sent: string;
        failed: string;
        skipped: string;
        pending: string;
      }>();

    const map = new Map<string, { planned: number; sent: number; failed: number; skipped: number; pending: number }>();
    for (const r of agg) {
      map.set(String(r.runId), {
        planned: Number(r.planned),
        sent: Number(r.sent),
        failed: Number(r.failed),
        skipped: Number(r.skipped),
        pending: Number(r.pending),
      });
    }

    // 覆盖 stats + 自动把"全部终态"的 run 标 Done
    const runsToFinalize: CampaignRunEntity[] = [];
    for (const run of runs) {
      const live = map.get(String(run.id));
      if (!live) continue;
      // 保留 fire 时写入的 skipped (号码超容量跳过) + 加上 target 层的 skipped
      const skipFromFire = run.stats?.skipped ?? 0;
      run.stats = {
        planned: live.planned + Math.max(0, skipFromFire - live.skipped), // planned = target 行数 + fire 阶段漏掉的
        sent: live.sent,
        failed: live.failed,
        skipped: Math.max(live.skipped, skipFromFire),
      };
      // 所有 target 都到终态 + run 还在 Running → 转 Done
      if (run.status === CampaignRunStatus.Running && live.pending === 0 && live.planned > 0) {
        run.status = CampaignRunStatus.Done;
        run.finishedAt = new Date();
        runsToFinalize.push(run);
      }
    }
    if (runsToFinalize.length > 0) {
      await this.runRepo.save(runsToFinalize);
      // 若某个 campaign 的所有 run 都 Done → campaign 自动 Done (仅 immediate/once)
      await this.autoFinishCampaign(campaignId);
    }
    return runs;
  }

  /**
   * 若 campaign 所有 run 都 Done 且 schedule 是 immediate/once → campaign 自动 Done
   * daily/weekly 持续跑, 不自动 Done
   */
  private async autoFinishCampaign(campaignId: number): Promise<void> {
    const cmp = await this.campaignRepo.findOne({ where: { id: campaignId } });
    if (!cmp || cmp.status !== CampaignStatus.Running) return;
    if (cmp.schedule.mode !== 'immediate' && cmp.schedule.mode !== 'once') return;
    const pending = await this.runRepo.count({
      where: [
        { campaignId, status: CampaignRunStatus.Pending },
        { campaignId, status: CampaignRunStatus.Running },
      ],
    });
    if (pending === 0) {
      cmp.status = CampaignStatus.Done;
      await this.campaignRepo.save(cmp);
      this.logger.log(`campaign ${campaignId} 所有 run 已完成 · 自动转 Done`);
    }
  }

  async listTargets(tenantId: number, campaignId: number, runId?: number) {
    await this.findById(tenantId, campaignId);
    // 2026-04-27 · 加 task.scheduled_at · 让 UI 显示 "等到 X 时执行" 不再让租户以为卡住
    const qb = this.targetRepo
      .createQueryBuilder('t')
      .leftJoin('task', 'task', 'task.id = t.task_id')
      .addSelect('task.scheduled_at', 't_scheduled_at')
      .addSelect('task.status', 't_task_status')
      .where('t.campaign_id = :campaignId', { campaignId })
      .orderBy('t.id', 'DESC')
      .take(500);
    if (runId !== undefined) qb.andWhere('t.run_id = :runId', { runId });
    const raw = await qb.getRawAndEntities();
    return raw.entities.map((row, i) => ({
      ...row,
      // 附加字段 · 不破坏原 entity 结构
      scheduledAt: raw.raw[i]?.t_scheduled_at ?? null,
      taskStatus: raw.raw[i]?.t_task_status ?? null,
    }));
  }

  // ──────────────────────────────────────────────────────────────
  // Report · 2026-04-24 · 结果报告聚合
  // ──────────────────────────────────────────────────────────────

  async report(tenantId: number, campaignId: number): Promise<CampaignReport> {
    const campaign = await this.findById(tenantId, campaignId);

    // 先刷一次 stats (顺便 autoFinish)
    await this.listRuns(tenantId, campaignId);

    // 总览
    const overallRow = await this.targetRepo
      .createQueryBuilder('t')
      .select('COUNT(*)', 'planned')
      .addSelect('SUM(CASE WHEN t.status = 2 THEN 1 ELSE 0 END)', 'sent')
      .addSelect('SUM(CASE WHEN t.status = 3 THEN 1 ELSE 0 END)', 'failed')
      .addSelect('SUM(CASE WHEN t.status = 4 THEN 1 ELSE 0 END)', 'skipped')
      .addSelect('SUM(CASE WHEN t.replied_at IS NOT NULL THEN 1 ELSE 0 END)', 'replied')
      .addSelect('SUM(t.reply_count)', 'replyCount')
      .addSelect('MIN(t.sent_at)', 'firstSent')
      .addSelect('MAX(t.sent_at)', 'lastSent')
      .where('t.campaign_id = :cid', { cid: campaignId })
      .getRawOne<{
        planned: string;
        sent: string;
        failed: string;
        skipped: string;
        replied: string;
        replyCount: string;
        firstSent: Date | null;
        lastSent: Date | null;
      }>();

    const planned = Number(overallRow?.planned ?? 0);
    const sent = Number(overallRow?.sent ?? 0);
    const failed = Number(overallRow?.failed ?? 0);
    const skipped = Number(overallRow?.skipped ?? 0);
    const replied = Number(overallRow?.replied ?? 0);
    const totalReplies = Number(overallRow?.replyCount ?? 0);

    // 账号表现
    const slotRows = await this.targetRepo
      .createQueryBuilder('t')
      .select('t.assigned_slot_id', 'slotId')
      .addSelect('s.slot_index', 'slotIndex')
      .addSelect('wa.phone_number', 'phoneNumber')
      .addSelect('COUNT(*)', 'assigned')
      .addSelect('SUM(CASE WHEN t.status = 2 THEN 1 ELSE 0 END)', 'sent')
      .addSelect('SUM(CASE WHEN t.status = 3 THEN 1 ELSE 0 END)', 'failed')
      .innerJoin('account_slot', 's', 's.id = t.assigned_slot_id')
      .leftJoin('wa_account', 'wa', 'wa.id = s.account_id')
      .where('t.campaign_id = :cid', { cid: campaignId })
      .groupBy('t.assigned_slot_id')
      .addGroupBy('s.slot_index')
      .addGroupBy('wa.phone_number')
      .orderBy('s.slot_index', 'ASC')
      .getRawMany<{
        slotId: number;
        slotIndex: number;
        phoneNumber: string | null;
        assigned: string;
        sent: string;
        failed: string;
      }>();

    const slotPerformance = slotRows.map((r) => {
      const a = Number(r.assigned);
      const s = Number(r.sent);
      const f = Number(r.failed);
      return {
        slotId: r.slotId,
        slotIndex: r.slotIndex,
        phoneNumber: r.phoneNumber,
        assigned: a,
        sent: s,
        failed: f,
        successRate: a > 0 ? Math.round((s / a) * 1000) / 10 : 0, // 1 位小数 %
      };
    });

    // 文案表现
    const adRows = await this.targetRepo
      .createQueryBuilder('t')
      .select('t.ad_id', 'adId')
      .addSelect('a.name', 'adName')
      .addSelect('COUNT(*)', 'used')
      .addSelect('SUM(CASE WHEN t.status = 2 THEN 1 ELSE 0 END)', 'sent')
      .addSelect('SUM(CASE WHEN t.status = 3 THEN 1 ELSE 0 END)', 'failed')
      .leftJoin('advertisement', 'a', 'a.id = t.ad_id')
      .where('t.campaign_id = :cid', { cid: campaignId })
      .groupBy('t.ad_id')
      .addGroupBy('a.name')
      .orderBy('used', 'DESC')
      .getRawMany<{
        adId: number | null;
        adName: string | null;
        used: string;
        sent: string;
        failed: string;
      }>();

    const adPerformance = adRows.map((r) => {
      const u = Number(r.used);
      const s = Number(r.sent);
      const f = Number(r.failed);
      return {
        adId: r.adId,
        adName: r.adName ?? `#${r.adId}`,
        used: u,
        sent: s,
        failed: f,
        successRate: u > 0 ? Math.round((s / u) * 1000) / 10 : 0,
      };
    });

    // 失败分类
    const errorRows = await this.targetRepo
      .createQueryBuilder('t')
      .select('COALESCE(t.error_code, \'UNKNOWN\')', 'code')
      .addSelect('COUNT(*)', 'count')
      .addSelect('MAX(t.error_msg)', 'sampleMsg')
      .where('t.campaign_id = :cid', { cid: campaignId })
      .andWhere('t.status = 3')
      .groupBy('t.error_code')
      .orderBy('count', 'DESC')
      .getRawMany<{ code: string; count: string; sampleMsg: string | null }>();

    const errorBreakdown = errorRows.map((r) => ({
      code: r.code,
      count: Number(r.count),
      sampleMsg: r.sampleMsg,
    }));

    // 时段分布 (小时粒度)
    const hourRows = await this.targetRepo
      .createQueryBuilder('t')
      .select(`TO_CHAR(t.sent_at AT TIME ZONE 'Asia/Kuala_Lumpur', 'HH24')`, 'hour')
      .addSelect('COUNT(*)', 'count')
      .where('t.campaign_id = :cid', { cid: campaignId })
      .andWhere('t.sent_at IS NOT NULL')
      .groupBy('hour')
      .orderBy('hour', 'ASC')
      .getRawMany<{ hour: string; count: string }>();
    const hourlyDistribution = hourRows.map((r) => ({
      hour: Number(r.hour),
      count: Number(r.count),
    }));

    const doneCount = sent + failed + skipped;
    const successRate = doneCount > 0 ? Math.round((sent / doneCount) * 1000) / 10 : 0;
    const replyRate = sent > 0 ? Math.round((replied / sent) * 1000) / 10 : 0;
    const firstSent = overallRow?.firstSent ? new Date(overallRow.firstSent) : null;
    const lastSent = overallRow?.lastSent ? new Date(overallRow.lastSent) : null;
    const durationMs = firstSent && lastSent ? lastSent.getTime() - firstSent.getTime() : 0;

    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      status: campaign.status,
      overall: {
        planned,
        sent,
        failed,
        skipped,
        successRate,
        doneCount,
        replied,
        totalReplies,
        replyRate,
      },
      timing: {
        firstSent,
        lastSent,
        durationMs,
      },
      slotPerformance,
      adPerformance,
      errorBreakdown,
      hourlyDistribution,
    };
  }

  /**
   * 复制为新投放 · 保留文案/开场白/客户群/执行模式/节流档 · schedule 改 immediate · 新 Draft 状态
   */
  async clone(
    tenantId: number,
    sourceId: number,
    createdBy: string | null,
  ): Promise<CampaignEntity> {
    const src = await this.findById(tenantId, sourceId);
    // 生成新名
    const baseName = `${src.name} (副本)`;
    let newName = baseName;
    let n = 2;
    while (await this.campaignRepo.findOne({ where: { tenantId, name: newName } })) {
      newName = `${src.name} (副本 ${n})`;
      n++;
    }
    const cloned = this.campaignRepo.create({
      tenantId,
      name: newName,
      schedule: { mode: 'immediate' } as CampaignEntity['schedule'],
      targets: {
        groupIds: [...(src.targets.groupIds ?? [])],
        extraPhones: [...(src.targets.extraPhones ?? [])],
      },
      adStrategy: src.adStrategy,
      adIds: [...src.adIds],
      openingStrategy: src.openingStrategy,
      openingIds: [...src.openingIds],
      executionMode: src.executionMode,
      customSlotIds: [...src.customSlotIds],
      throttleProfile: src.throttleProfile,
      safetyStatus: SafetyStatus.Green,
      safetySnapshot: null,
      status: CampaignStatus.Draft,
      createdBy,
    });
    return this.campaignRepo.save(cloned);
  }

  // ──────────────────────────────────────────────────────────────
  // Preview Safety
  // ──────────────────────────────────────────────────────────────

  async previewSafety(tenantId: number, dto: PreviewSafetyDto) {
    const profile = dto.throttleProfile ?? ThrottleProfile.Conservative;
    return this.safety.compute(
      tenantId,
      dto.schedule,
      dto.targets,
      dto.executionMode,
      dto.customSlotIds,
      profile,
    );
  }

  // ──────────────────────────────────────────────────────────────
  // Create + Start
  // ──────────────────────────────────────────────────────────────

  async create(tenantId: number, createdBy: string | null, dto: CreateCampaignDto): Promise<CampaignEntity> {
    this.validateSchedule(dto);

    // 广告 ID 校验
    const ads = await this.ads.findEnabled(tenantId, dto.adIds);
    if (ads.length !== dto.adIds.length) {
      throw new BadRequestException('存在无效或已禁用的广告 ID');
    }
    if (dto.adStrategy === AdStrategy.Single && dto.adIds.length !== 1) {
      throw new BadRequestException('单一广告模式只能选 1 条');
    }
    if (dto.adStrategy === AdStrategy.Rotation && dto.adIds.length < 2) {
      throw new BadRequestException('多广告轮换至少选 2 条');
    }

    // 开场白校验
    if (dto.openingStrategy !== OpeningStrategy.None) {
      const openingIds = dto.openingIds ?? [];
      if (dto.openingStrategy === OpeningStrategy.Fixed && openingIds.length !== 1) {
        throw new BadRequestException('固定开场必须选 1 条');
      }
      if (dto.openingStrategy === OpeningStrategy.Random && openingIds.length < 2) {
        throw new BadRequestException('随机开场建议至少选 2 条');
      }
      const lines = await this.openings.findEnabled(tenantId, openingIds);
      if (lines.length !== openingIds.length) {
        throw new BadRequestException('存在无效或已禁用的开场白 ID');
      }
    }

    // 自定义槽位校验
    if (dto.executionMode === ExecutionMode.CustomSlots) {
      if (!dto.customSlotIds || dto.customSlotIds.length === 0) {
        throw new BadRequestException('自定义槽位模式必须选至少 1 个槽位');
      }
    }

    const profile = dto.throttleProfile ?? ThrottleProfile.Conservative;

    // 承载预览 · 红色直接拒绝
    const preview = await this.safety.compute(
      tenantId,
      dto.schedule,
      dto.targets,
      dto.executionMode,
      dto.customSlotIds,
      profile,
    );
    if (preview.status === SafetyStatus.Red) {
      throw new BadRequestException(`承载不足: ${preview.message}`);
    }

    const startNow = dto.startNow ?? true;

    const campaign = this.campaignRepo.create({
      tenantId,
      name: dto.name,
      schedule: dto.schedule,
      targets: {
        groupIds: dto.targets.groupIds ?? [],
        extraPhones: dto.targets.extraPhones ?? [],
      },
      adStrategy: dto.adStrategy,
      adIds: dto.adIds,
      openingStrategy: dto.openingStrategy,
      openingIds: dto.openingIds ?? [],
      executionMode: dto.executionMode,
      customSlotIds: dto.customSlotIds ?? [],
      throttleProfile: profile,
      safetyStatus: preview.status,
      safetySnapshot: { ...preview, computedAt: new Date().toISOString() },
      status: startNow ? CampaignStatus.Running : CampaignStatus.Draft,
      createdBy,
    });
    const saved = await this.campaignRepo.save(campaign);
    this.logger.log(
      `create campaign ${saved.id} "${saved.name}" · tenant=${tenantId} · mode=${saved.schedule.mode} · status=${saved.status}`,
    );

    if (startNow) {
      await this.expander.expand(saved);
    }
    return saved;
  }

  async update(tenantId: number, id: number, dto: UpdateCampaignDto): Promise<CampaignEntity> {
    const row = await this.findById(tenantId, id);
    if (dto.name !== undefined) row.name = dto.name;
    return this.campaignRepo.save(row);
  }

  async pause(tenantId: number, id: number): Promise<CampaignEntity> {
    const row = await this.findById(tenantId, id);
    if (row.status !== CampaignStatus.Running) {
      throw new BadRequestException(`任务状态 ${row.status} 不可暂停`);
    }
    row.status = CampaignStatus.Paused;
    return this.campaignRepo.save(row);
  }

  async resume(tenantId: number, id: number): Promise<CampaignEntity> {
    const row = await this.findById(tenantId, id);
    if (row.status !== CampaignStatus.Paused) {
      throw new BadRequestException(`任务状态 ${row.status} 不可恢复`);
    }
    row.status = CampaignStatus.Running;
    await this.campaignRepo.save(row);
    await this.expander.expand(row); // 恢复时补展
    return row;
  }

  async start(tenantId: number, id: number): Promise<CampaignEntity> {
    const row = await this.findById(tenantId, id);
    if (row.status !== CampaignStatus.Draft) {
      throw new BadRequestException(`任务状态 ${row.status} 不可启动`);
    }
    row.status = CampaignStatus.Running;
    await this.campaignRepo.save(row);
    await this.expander.expand(row);
    return row;
  }

  /**
   * 2026-04-27 · 强推 · 把这个投放下所有 pending task 的 scheduled_at 改成 NOW
   * 跳过节流窗口 · 立即让 dispatcher 捡起来执行
   * 仅作用于 task.status='pending' 的任务 · 已 done/failed 的不动
   */
  async runNow(
    tenantId: number,
    campaignId: number,
  ): Promise<{ pushed: number }> {
    await this.findById(tenantId, campaignId);
    // 找出该 campaign 下所有 dispatched 状态的 target 对应 task
    const result = (await this.targetRepo.query(
      `
      UPDATE task
      SET scheduled_at = NOW()
      WHERE id IN (
        SELECT ct.task_id::int FROM campaign_target ct
        WHERE ct.campaign_id = $1
          AND ct.task_id IS NOT NULL
          AND ct.status = 1
      )
      AND status = 'pending'
      RETURNING id as task_id
      `,
      [campaignId],
    )) as Array<{ task_id: number }>;
    const pushed = result.length;
    this.logger.log(
      `runNow · campaign ${campaignId} · 强推 ${pushed} 个 task scheduled_at=NOW`,
    );
    return { pushed };
  }

  /**
   * 2026-04-28 · 强推单个 target · 把这一个 target 对应 task 的 scheduled_at 改成 NOW
   * 跳过节流窗口 · 立即让 dispatcher 捡起来执行
   * 仅作用于 task.status='pending' 的任务 · 已 done/failed/in-progress 的不动
   * UI 设计: targets 表每行的"立即执行"按钮调这个 (per-task 不是 per-campaign)
   */
  async runNowTarget(
    tenantId: number,
    campaignId: number,
    targetId: string,
  ): Promise<{ pushed: boolean; reason?: string }> {
    await this.findById(tenantId, campaignId);
    // 验 target 属于本 campaign 且状态是 dispatched
    const target = await this.targetRepo.findOne({
      where: { id: targetId, campaignId },
    });
    if (!target) {
      throw new NotFoundException(`目标 ${targetId} 不存在或不属于该投放`);
    }
    if (target.taskId === null) {
      return { pushed: false, reason: '该目标未派发任务 (尚未生成 task)' };
    }
    if (target.status !== 1) {
      // 0=pending 1=dispatched 2=sent 3=failed 4=skipped
      return {
        pushed: false,
        reason: `目标状态 ${target.status} · 仅 dispatched 可强推`,
      };
    }
    // 2026-04-28 · 立即执行 · 同时写 payload.forceRun=true · dispatcher 看到该 flag
    // 跳过 night-window 检查 (用户已确认 modal 风险, 夜间窗口该让位给 user override)
    const result = (await this.targetRepo.query(
      `UPDATE task SET
         scheduled_at = NOW(),
         payload = jsonb_set(COALESCE(payload, '{}'::jsonb), '{forceRun}', 'true'::jsonb)
       WHERE id = $1 AND status = 'pending'
       RETURNING id as task_id`,
      [target.taskId],
    )) as Array<{ task_id: number }>;
    if (result.length === 0) {
      return { pushed: false, reason: 'task 状态已非 pending (可能已在执行或完成)' };
    }
    this.logger.log(
      `runNowTarget · campaign ${campaignId} · target ${targetId} · task ${target.taskId} 强推 scheduled_at=NOW`,
    );
    return { pushed: true };
  }

  /**
   * 2026-04-28 · 删除单个 target · 取消未执行的 task + 标 target 跳过
   * UI: targets 表每行的"删除"按钮调这个
   * 行为:
   *   - 若 task 仍 pending: UPDATE task SET status='cancelled'
   *   - target.status = 4 (Skipped)
   *   - errorCode/errorMsg 标记 'CANCELLED_BY_USER'
   *   - 不物理 DELETE row (保留审计 + 报告统计)
   */
  async cancelTarget(
    tenantId: number,
    campaignId: number,
    targetId: string,
  ): Promise<{ cancelled: boolean; taskCancelled: boolean }> {
    await this.findById(tenantId, campaignId);
    const target = await this.targetRepo.findOne({
      where: { id: targetId, campaignId },
    });
    if (!target) {
      throw new NotFoundException(`目标 ${targetId} 不存在或不属于该投放`);
    }
    let taskCancelled = false;
    if (target.taskId !== null) {
      const r = (await this.targetRepo.query(
        `UPDATE task SET status = 'cancelled', last_error = 'cancelled by user'
         WHERE id = $1 AND status = 'pending'
         RETURNING id`,
        [target.taskId],
      )) as Array<{ id: number }>;
      taskCancelled = r.length > 0;
    }
    await this.targetRepo.update(target.id, {
      status: 4, // Skipped
      errorCode: 'CANCELLED_BY_USER',
      errorMsg: '用户在 UI 删除',
    });
    this.logger.log(
      `cancelTarget · campaign ${campaignId} · target ${targetId} · taskCancelled=${taskCancelled}`,
    );
    return { cancelled: true, taskCancelled };
  }

  async cancel(tenantId: number, id: number): Promise<void> {
    const row = await this.findById(tenantId, id);
    row.status = CampaignStatus.Cancelled;
    await this.campaignRepo.save(row);
    // 取消所有 pending run
    await this.runRepo.update(
      { campaignId: id, status: CampaignRunStatus.Pending },
      { status: CampaignRunStatus.Cancelled, finishedAt: new Date() },
    );
  }

  // ──────────────────────────────────────────────────────────────
  // Schedule 运行时校验 (class-validator 校验不到的)
  // ──────────────────────────────────────────────────────────────

  private validateSchedule(dto: CreateCampaignDto): void {
    const s = dto.schedule;
    if (!s || typeof s !== 'object') throw new BadRequestException('schedule 不能为空');
    const mode = (s as { mode?: string }).mode;
    if (!['immediate', 'once', 'daily', 'weekly'].includes(mode ?? '')) {
      throw new BadRequestException('schedule.mode 必须是 immediate/once/daily/weekly');
    }
    if (mode === 'once' && !(s as { fireAt?: string }).fireAt) {
      throw new BadRequestException('once 模式必须提供 fireAt');
    }
    if ((mode === 'daily' || mode === 'weekly') && !(s as { time?: string }).time) {
      throw new BadRequestException(`${mode} 模式必须提供 time (HH:MM)`);
    }
    if ((mode === 'daily' || mode === 'weekly') && !(s as { startDate?: string }).startDate) {
      throw new BadRequestException(`${mode} 模式必须提供 startDate`);
    }
    if (mode === 'weekly') {
      const days = (s as { days?: number[] }).days;
      if (!Array.isArray(days) || days.length === 0) {
        throw new BadRequestException('weekly 模式必须选至少 1 个星期几');
      }
      for (const d of days) {
        if (!Number.isInteger(d) || d < 0 || d > 6) {
          throw new BadRequestException('weekly.days 必须是 0-6 (周日 0)');
        }
      }
    }

    if (!dto.targets || typeof dto.targets !== 'object') {
      throw new BadRequestException('targets 不能为空');
    }
    const groupIds = dto.targets.groupIds ?? [];
    const extraPhones = dto.targets.extraPhones ?? [];
    if (groupIds.length === 0 && extraPhones.length === 0) {
      throw new BadRequestException('至少提供一个客户群或手动号码');
    }
  }
}
