import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Logger,
  NotFoundException,
  OnModuleInit,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountHealthEntity, RiskLevel } from '../slots/account-health.entity';
import { WaAccountEntity } from '../slots/wa-account.entity';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { RISK_EVENT_CHANNEL, type RiskRawEvent } from '../account-health/risk.events';
import {
  RiskEventCode,
  type RiskEventSeverity,
} from '../account-health/risk-event.entity';

// Dev-only: 手动调 risk_level 验证 regress 链路.
// 用户 2026-04-20 要求: NODE_ENV !== 'production' 才响应, 生产 build 时直接拒绝.
// M8 健康分引擎实装后本 controller 的写入能力可保留作为"模拟注入"工具.
@Controller({ path: 'admin/debug', version: '1' })
export class AdminDebugController implements OnModuleInit {
  private readonly logger = new Logger(AdminDebugController.name);
  private readonly isProd: boolean;

  constructor(
    config: ConfigService,
    @InjectRepository(AccountHealthEntity) private readonly healthRepo: Repository<AccountHealthEntity>,
    @InjectRepository(WaAccountEntity) private readonly accountRepo: Repository<WaAccountEntity>,
    private readonly eventBus: EventEmitter2,
  ) {
    this.isProd = config.get<string>('NODE_ENV', 'development') === 'production';
  }

  onModuleInit(): void {
    if (this.isProd) {
      this.logger.warn('AdminDebugController loaded in production — all endpoints will 403');
    } else {
      this.logger.log('AdminDebugController ENABLED (dev mode) — /admin/debug/* 可写');
    }
  }

  @Post('set-risk-level')
  async setRiskLevel(
    @CurrentUser() cur: RequestUser,
    @Body() body: { accountId: number; riskLevel: string },
  ) {
    if (this.isProd) {
      throw new ForbiddenException('debug endpoint 仅 dev / staging 可用');
    }
    if (cur.tenantId !== null) {
      throw new ForbiddenException('仅平台超管可用 debug endpoint');
    }
    if (!body.accountId || !body.riskLevel) {
      throw new BadRequestException('需 { accountId, riskLevel: low|medium|high }');
    }
    const level = body.riskLevel.toLowerCase();
    if (!(Object.values(RiskLevel) as string[]).includes(level)) {
      throw new BadRequestException(`riskLevel 需 ${Object.values(RiskLevel).join('|')}`);
    }

    const account = await this.accountRepo.findOne({ where: { id: body.accountId } });
    if (!account) throw new NotFoundException(`account ${body.accountId} 不存在`);

    let health = await this.healthRepo.findOne({ where: { accountId: body.accountId } });
    if (!health) {
      health = this.healthRepo.create({
        accountId: body.accountId,
        healthScore: level === 'high' ? 20 : level === 'medium' ? 45 : 80,
        riskLevel: level as RiskLevel,
      });
    } else {
      health.riskLevel = level as RiskLevel;
      if (level === 'high' && health.healthScore > 29) health.healthScore = 20;
      if (level === 'medium' && (health.healthScore < 30 || health.healthScore > 59)) health.healthScore = 45;
      if (level === 'low' && health.healthScore < 60) health.healthScore = 80;
    }
    await this.healthRepo.save(health);
    this.logger.warn(`[DEBUG] set accountId=${body.accountId} risk=${level}`);
    return { ok: true, accountId: body.accountId, riskLevel: level, score: health.healthScore };
  }

  /**
   * Cascade [3] 验 · 真降级 mechanism.
   * 批量 emit risk.raw event · 触发 scorer.rescore → handleScoreTransition → alerts.dispatch
   * 每事件带唯一 sourceRef 避免去重. dry_run=false 时 30min 后真回退 Phase 0.
   */
  @Post('inject-risk-event')
  async injectRiskEvent(
    @CurrentUser() cur: RequestUser,
    @Body()
    body: { accountId: number; code?: string; count?: number; severity?: RiskEventSeverity },
  ) {
    if (this.isProd) {
      throw new ForbiddenException('debug endpoint 仅 dev / staging 可用');
    }
    if (cur.tenantId !== null) {
      throw new ForbiddenException('仅平台超管可用 debug endpoint');
    }
    if (!body.accountId) throw new BadRequestException('需 accountId');

    const account = await this.accountRepo.findOne({ where: { id: body.accountId } });
    if (!account) throw new NotFoundException(`account ${body.accountId} 不存在`);

    const code = body.code ?? RiskEventCode.CaptchaTriggered;
    const count = Math.min(Math.max(body.count ?? 1, 1), 50);
    const severity: RiskEventSeverity = body.severity ?? 'warn';
    const now = Date.now();

    const emitted: string[] = [];
    for (let i = 0; i < count; i++) {
      const sourceRef = `debug-inject-${now}-${i}`;
      const payload: RiskRawEvent = {
        accountId: body.accountId,
        code,
        severity,
        source: 'admin-debug',
        sourceRef,
        at: new Date(now - i * 1000),
        meta: { injectedBy: cur.email ?? 'platform-admin' },
      };
      this.eventBus.emit(RISK_EVENT_CHANNEL, payload);
      emitted.push(sourceRef);
    }
    this.logger.warn(
      `[DEBUG] injected ${count} risk events · acc=${body.accountId} code=${code} severity=${severity}`,
    );
    return {
      ok: true,
      accountId: body.accountId,
      code,
      count,
      severity,
      emittedFirst: emitted.slice(0, 3),
    };
  }
}
