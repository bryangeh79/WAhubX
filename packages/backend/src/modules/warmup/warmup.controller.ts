import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { WarmupPlanService } from './warmup-plan.service';
import { WarmupPhaseService } from './warmup-phase.service';
import { WarmupCalendarService } from './warmup-calendar.service';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';

@Controller({ path: 'warmup', version: '1' })
export class WarmupController {
  constructor(
    private readonly planService: WarmupPlanService,
    private readonly phaseService: WarmupPhaseService,
    private readonly calendarService: WarmupCalendarService,
  ) {}

  @Get('plans')
  async list(@CurrentUser() cur: RequestUser) {
    if (cur.tenantId === null) {
      throw new ForbiddenException('平台超管查询需指定租户 — 走 Admin API');
    }
    return this.planService.listForTenant(cur.tenantId);
  }

  @Get('plans/:accountId')
  async findOne(@CurrentUser() cur: RequestUser, @Param('accountId', ParseIntPipe) accountId: number) {
    const plan = await this.planService.findByAccount(accountId);
    if (!plan) throw new NotFoundException(`account ${accountId} 无 warmup_plan`);
    return plan;
  }

  @Post('plans/:accountId/skip-phase')
  @HttpCode(HttpStatus.OK)
  async skip(
    @CurrentUser() _cur: RequestUser,
    @Param('accountId', ParseIntPipe) accountId: number,
    @Body() body: { reason?: string },
  ) {
    const plan = await this.planService.findByAccount(accountId);
    if (!plan) throw new NotFoundException(`account ${accountId} 无 warmup_plan`);
    return this.phaseService.skipToNextPhase(plan.id, body.reason ?? '(no reason)');
  }

  @Post('plans/:accountId/pause')
  @HttpCode(HttpStatus.OK)
  async pause(
    @Param('accountId', ParseIntPipe) accountId: number,
    @Body() body: { reason?: string },
  ) {
    const plan = await this.planService.findByAccount(accountId);
    if (!plan) throw new NotFoundException(`account ${accountId} 无 warmup_plan`);
    return this.phaseService.pause(plan.id, body.reason ?? '(user pause)');
  }

  @Post('plans/:accountId/resume')
  @HttpCode(HttpStatus.OK)
  async resume(@Param('accountId', ParseIntPipe) accountId: number) {
    const plan = await this.planService.findByAccount(accountId);
    if (!plan) throw new NotFoundException(`account ${accountId} 无 warmup_plan`);
    return this.phaseService.resume(plan.id);
  }

  @Post('plans/:accountId/init')
  @HttpCode(HttpStatus.CREATED)
  async init(@Param('accountId', ParseIntPipe) accountId: number, @Body() body: { template?: string }) {
    return this.planService.initForAccount(accountId, body.template);
  }

  /**
   * 手动 tick (dev / smoke). Prod 由 setInterval 每 1h 自动.
   */
  @Post('calendar/tick')
  @HttpCode(HttpStatus.OK)
  async manualTick(@CurrentUser() cur: RequestUser) {
    if (cur.tenantId !== null) {
      throw new ForbiddenException('calendar tick 仅平台超管可手动触发');
    }
    return this.calendarService.tick();
  }
}
