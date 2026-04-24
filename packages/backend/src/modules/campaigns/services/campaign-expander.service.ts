import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CampaignEntity,
  CampaignSchedule,
} from '../entities/campaign.entity';
import { CampaignRunEntity, CampaignRunStatus } from '../entities/campaign-run.entity';
import { ThrottleProfileService } from './throttle-profile.service';

// 2026-04-23 · campaign.schedule → campaign_run 行展开 · plan §D

@Injectable()
export class CampaignExpanderService {
  private readonly logger = new Logger(CampaignExpanderService.name);

  constructor(
    @InjectRepository(CampaignRunEntity)
    private readonly runRepo: Repository<CampaignRunEntity>,
    private readonly throttle: ThrottleProfileService,
  ) {}

  /**
   * Campaign 创建或每日补展时调用
   * 返回新生成的 campaign_run 数量
   */
  async expand(campaign: CampaignEntity, now: Date = new Date()): Promise<number> {
    const horizon = await this.throttle.getDefaultHorizonDays();
    const firings = this.listFiringTimes(campaign.schedule, now, horizon);
    if (firings.length === 0) return 0;

    // 查现有 run 避免重复
    const existing = await this.runRepo.find({
      where: { campaignId: campaign.id },
      select: ['fireAt'],
    });
    const existSet = new Set(existing.map((r) => r.fireAt.getTime()));

    const toInsert = firings
      .filter((t) => !existSet.has(t.getTime()))
      .map((t) =>
        this.runRepo.create({
          campaignId: campaign.id,
          fireAt: t,
          status: CampaignRunStatus.Pending,
          stats: {},
        }),
      );

    if (toInsert.length === 0) return 0;
    await this.runRepo.save(toInsert);
    this.logger.log(
      `campaign ${campaign.id} "${campaign.name}" 展开 ${toInsert.length} 个 run (schedule.mode=${campaign.schedule.mode})`,
    );
    return toInsert.length;
  }

  /**
   * 根据 schedule 列出未来 [now, now+horizonDays] 的 fire 时间
   * 上层用 Set 去重避免重复 run
   */
  listFiringTimes(schedule: CampaignSchedule, from: Date, horizonDays: number): Date[] {
    const out: Date[] = [];

    if (schedule.mode === 'immediate') {
      out.push(from);
      return out;
    }

    if (schedule.mode === 'once') {
      const t = new Date(schedule.fireAt);
      if (!Number.isNaN(t.getTime()) && t.getTime() >= from.getTime() - 60_000) {
        out.push(t);
      }
      return out;
    }

    if (schedule.mode === 'daily') {
      const [hh, mm] = (schedule.time ?? '20:00').split(':').map(Number);
      const start = new Date(schedule.startDate);
      start.setHours(hh, mm, 0, 0);
      const end = schedule.endDate ? new Date(schedule.endDate) : new Date(from.getTime() + horizonDays * 86_400_000);
      end.setHours(23, 59, 59, 999);

      const cur = new Date(Math.max(start.getTime(), from.getTime() - 24 * 3_600_000));
      cur.setHours(hh, mm, 0, 0);
      let safety = 0;
      while (cur.getTime() <= end.getTime() && safety < 400) {
        if (cur.getTime() >= from.getTime() - 60_000) out.push(new Date(cur));
        cur.setDate(cur.getDate() + 1);
        safety++;
      }
      return out;
    }

    if (schedule.mode === 'weekly') {
      const [hh, mm] = (schedule.time ?? '20:00').split(':').map(Number);
      const wdays = new Set(schedule.days ?? []);
      if (wdays.size === 0) return out;

      const start = new Date(schedule.startDate);
      const end = schedule.endDate ? new Date(schedule.endDate) : new Date(from.getTime() + horizonDays * 86_400_000);
      end.setHours(23, 59, 59, 999);

      const cur = new Date(Math.max(start.getTime(), from.getTime() - 24 * 3_600_000));
      cur.setHours(hh, mm, 0, 0);
      let safety = 0;
      while (cur.getTime() <= end.getTime() && safety < 400) {
        if (wdays.has(cur.getDay()) && cur.getTime() >= from.getTime() - 60_000) {
          out.push(new Date(cur));
        }
        cur.setDate(cur.getDate() + 1);
        safety++;
      }
      return out;
    }

    return out;
  }
}
