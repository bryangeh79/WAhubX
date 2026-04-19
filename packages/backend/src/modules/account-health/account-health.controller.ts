import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AccountHealthEntity } from '../slots/account-health.entity';
import { WaAccountEntity } from '../slots/wa-account.entity';
import { AccountSlotEntity } from '../slots/account-slot.entity';
import { RiskEventService } from './risk-event.service';
import { HealthScorerService } from './health-scorer.service';
import { HealthSettingsService } from './health-settings.service';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';

// §5.4 健康分 API · M8
//   GET /account-health/overview       租户视角列每号健康分 + level
//   GET /account-health/:accountId     单号详情 + breakdown + 近 30 event + 7 天趋势
//   POST /account-health/:accountId/rescore
//   GET /account-health/settings
//   POST /account-health/settings/dry-run   { enabled }
//   POST /account-health/settings/scoring-window-days   { days }
@Controller({ path: 'account-health', version: '1' })
export class AccountHealthController {
  constructor(
    private readonly scorer: HealthScorerService,
    private readonly events: RiskEventService,
    private readonly settings: HealthSettingsService,
    @InjectRepository(AccountHealthEntity) private readonly healthRepo: Repository<AccountHealthEntity>,
    @InjectRepository(AccountSlotEntity) private readonly slotRepo: Repository<AccountSlotEntity>,
    @InjectRepository(WaAccountEntity) private readonly accountRepo: Repository<WaAccountEntity>,
  ) {}

  @Get('overview')
  async overview(@CurrentUser() cur: RequestUser) {
    if (cur.tenantId === null) {
      throw new ForbiddenException('平台超管请改走全局视图 (未实装); 使用租户 admin 查自己租户');
    }
    const slots = await this.slotRepo.find({ where: { tenantId: cur.tenantId } });
    const accountIds = slots.filter((s) => s.accountId !== null).map((s) => s.accountId as number);
    if (accountIds.length === 0) return [];
    const [healths, accounts] = await Promise.all([
      this.healthRepo.find({ where: { accountId: In(accountIds) } }),
      this.accountRepo.find({ where: { id: In(accountIds) } }),
    ]);
    const healthByAcc = new Map(healths.map((h) => [h.accountId, h]));
    const accMap = new Map(accounts.map((a) => [a.id, a]));
    return slots
      .filter((s) => s.accountId !== null)
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .map((s) => {
        const h = healthByAcc.get(s.accountId as number);
        const acc = accMap.get(s.accountId as number);
        return {
          slotIndex: s.slotIndex,
          accountId: s.accountId,
          phoneNumber: acc?.phoneNumber ?? '',
          warmupStage: acc?.warmupStage ?? 0,
          healthScore: h?.healthScore ?? 100,
          riskLevel: h?.riskLevel ?? 'low',
          updatedAt: h?.updatedAt ?? null,
        };
      });
  }

  @Get(':accountId')
  async detail(@Param('accountId', ParseIntPipe) accountId: number) {
    const [result, events, trend, health] = await Promise.all([
      this.scorer.rescore(accountId),
      this.events.findRecent(accountId, 30),
      this.events.trendDaily(accountId, 7),
      this.healthRepo.findOne({ where: { accountId } }),
    ]);
    return {
      ...result,
      totalSent: health?.totalSent ?? 0,
      totalReceived: health?.totalReceived ?? 0,
      recentEvents: events,
      trend7d: trend,
    };
  }

  @Post(':accountId/rescore')
  @HttpCode(HttpStatus.OK)
  async rescore(@Param('accountId', ParseIntPipe) accountId: number) {
    return this.scorer.rescore(accountId);
  }

  @Get('settings')
  async getSettings(@CurrentUser() cur: RequestUser) {
    if (cur.tenantId !== null) {
      throw new ForbiddenException('仅平台超管可读 health 全局设置');
    }
    return this.settings.snapshot();
  }

  @Post('settings/dry-run')
  @HttpCode(HttpStatus.OK)
  async setDryRun(@CurrentUser() cur: RequestUser, @Body() body: { enabled: boolean }) {
    if (cur.tenantId !== null) throw new ForbiddenException('仅平台超管');
    const dryRun = await this.settings.setDryRun(!!body.enabled);
    return { dryRun };
  }

  @Post('settings/scoring-window-days')
  @HttpCode(HttpStatus.OK)
  async setWindow(@CurrentUser() cur: RequestUser, @Body() body: { days: number }) {
    if (cur.tenantId !== null) throw new ForbiddenException('仅平台超管');
    const days = await this.settings.setScoringWindowDays(body.days);
    return { scoringWindowDays: days };
  }
}
