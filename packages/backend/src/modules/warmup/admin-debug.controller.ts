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
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountHealthEntity, RiskLevel } from '../slots/account-health.entity';
import { WaAccountEntity } from '../slots/wa-account.entity';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';

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
}
