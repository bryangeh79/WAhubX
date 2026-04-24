import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  CampaignSchedule,
  CampaignTargets,
  ExecutionMode,
  SafetyStatus,
  ThrottleProfile,
} from '../entities/campaign.entity';
import { MatureSlotPickerService } from './mature-slot-picker.service';
import { ThrottleProfileService } from './throttle-profile.service';
import { normalizePhone } from '../utils/phone';

// 2026-04-23 · 承载算法 · plan §C
//
// 公式:
//   matureSlots   = 成熟号总数
//   eligibleSlots = execution_mode=1 ? matureSlots : matureSlots ∩ custom_slot_ids
//   dailyCap      = throttle_profile 对应 app_setting
//   totalTargets  = 去重 (customer_groups 成员 ∪ extraPhones)
//   days          = schedule 决定 · 见 computeDays
//   capacity      = eligibleSlots × dailyCap × days
//   rate          = capacity / totalTargets
//   绿 ≥1.0 / 黄 0.7-1 / 红 <0.7

export interface SafetyPreview {
  matureSlots: number;
  eligibleSlots: number;
  // 2026-04-24 · 自定义模式下租户选了几个未成熟号 · 有风险但允许
  immatureSlots?: number;
  dailyCap: number;
  totalTargets: number;
  days: number;
  capacity: number;
  rate: number;
  status: SafetyStatus;
  // 租户友好说明 · 前端直接展示
  message: string;
}

@Injectable()
export class SafetyCapacityService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly matureSlots: MatureSlotPickerService,
    private readonly throttle: ThrottleProfileService,
  ) {}

  async compute(
    tenantId: number,
    schedule: CampaignSchedule,
    targets: CampaignTargets,
    executionMode: ExecutionMode,
    customSlotIds: number[] | undefined,
    profile: ThrottleProfile,
  ): Promise<SafetyPreview> {
    const allMature = await this.matureSlots.findMatureSlots(tenantId);
    const matureSlots = allMature.length;

    let eligibleSlots = matureSlots;
    let immatureSlots = 0;
    if (executionMode === ExecutionMode.CustomSlots) {
      if (!customSlotIds || customSlotIds.length === 0) {
        eligibleSlots = 0;
      } else {
        // 2026-04-24 · 租户可强制选未成熟号 · 承载按"选中的 active 号数"计
        const selectedActive = await this.matureSlots.findSlotsIn(tenantId, customSlotIds);
        eligibleSlots = selectedActive.length;
        immatureSlots = selectedActive.filter((s) => !s.isMature).length;
      }
    }

    const params = await this.throttle.get(profile);
    const dailyCap = params.dailyCap;

    const totalTargets = await this.countTargets(tenantId, targets);
    const days = await this.computeDays(schedule);

    const capacity = eligibleSlots * dailyCap * days;
    const rate = totalTargets === 0 ? Infinity : capacity / totalTargets;

    let status: SafetyStatus;
    let message: string;
    if (totalTargets === 0) {
      status = SafetyStatus.Red;
      message = '目标对象数为 0 · 请先添加客户群或手动号码';
    } else if (eligibleSlots === 0) {
      status = SafetyStatus.Red;
      message =
        executionMode === ExecutionMode.CustomSlots
          ? '未选中任何账号 · 请勾选至少 1 个槽位'
          : '没有可用的成熟营运号 · 请先等账号完成养号 (14 天)';
    } else if (rate >= 1.0) {
      status = SafetyStatus.Green;
      message =
        immatureSlots > 0
          ? `承载充足 · 可覆盖全部 ${totalTargets} 个目标 · ⚠ 含 ${immatureSlots} 个未成熟号 (封号风险高)`
          : `承载充足 · 可覆盖全部 ${totalTargets} 个目标`;
    } else if (rate >= 0.7) {
      status = SafetyStatus.Yellow;
      const covered = Math.floor(capacity);
      message =
        immatureSlots > 0
          ? `承载偏紧 · 预计可发送 ${covered}/${totalTargets} · ⚠ 含 ${immatureSlots} 个未成熟号`
          : `承载偏紧 · 预计可发送 ${covered}/${totalTargets} · 建议增加成熟号或减少目标`;
    } else {
      status = SafetyStatus.Red;
      message = `承载严重不足 · ${eligibleSlots} 个号无法覆盖 ${totalTargets} 个目标 · 请调整`;
    }

    return {
      matureSlots,
      eligibleSlots,
      immatureSlots,
      dailyCap,
      totalTargets,
      days,
      capacity,
      rate,
      status,
      message,
    };
  }

  /**
   * 计算目标人数 (去重 customer_group 成员 ∪ extraPhones)
   */
  async countTargets(tenantId: number, targets: CampaignTargets): Promise<number> {
    const phones = new Set<string>();

    for (const raw of targets.extraPhones ?? []) {
      const n = normalizePhone(raw);
      if (n) phones.add(n);
    }

    const groupIds = targets.groupIds ?? [];
    if (groupIds.length > 0) {
      const rows = await this.dataSource.query<Array<{ phone_e164: string }>>(
        `
        SELECT DISTINCT m.phone_e164
        FROM customer_group_member m
        INNER JOIN customer_group g ON g.id = m.group_id
        WHERE g.tenant_id = $1
          AND m.group_id = ANY($2::int[])
        `,
        [tenantId, groupIds],
      );
      for (const r of rows) {
        if (r.phone_e164) phones.add(r.phone_e164);
      }
    }

    return phones.size;
  }

  /**
   * schedule → 对"承载窗口天数" 估算
   * immediate/once → 1
   * daily → endDate-startDate+1 (无 endDate 用 default_horizon_days)
   * weekly → [start, end||start+30d] 内命中 days[] 的日期数
   */
  async computeDays(schedule: CampaignSchedule): Promise<number> {
    if (schedule.mode === 'immediate' || schedule.mode === 'once') return 1;

    if (schedule.mode === 'daily') {
      const horizon = await this.throttle.getDefaultHorizonDays();
      const start = new Date(schedule.startDate);
      const end = schedule.endDate ? new Date(schedule.endDate) : null;
      if (!end) return horizon;
      const diff = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
      return Math.max(1, diff);
    }

    if (schedule.mode === 'weekly') {
      const horizon = await this.throttle.getDefaultHorizonDays();
      const days = schedule.days ?? [];
      if (days.length === 0) return 0;
      const start = new Date(schedule.startDate);
      const end = schedule.endDate ? new Date(schedule.endDate) : new Date(start.getTime() + 30 * 86_400_000);
      const set = new Set(days);
      let cnt = 0;
      const cur = new Date(start);
      cur.setHours(0, 0, 0, 0);
      const hardEnd = new Date(end);
      hardEnd.setHours(0, 0, 0, 0);
      let safety = 0;
      while (cur.getTime() <= hardEnd.getTime() && safety < 400) {
        if (set.has(cur.getDay())) cnt++;
        cur.setDate(cur.getDate() + 1);
        safety++;
      }
      // 无 endDate 时, 用 horizon 做 upper bound
      if (!schedule.endDate) {
        return Math.min(cnt, Math.ceil((horizon * 7) / 7)); // effectively cnt
      }
      return Math.max(1, cnt);
    }

    return 1;
  }
}
