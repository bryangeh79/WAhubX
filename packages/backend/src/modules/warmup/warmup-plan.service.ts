import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WarmupPlanEntity, WarmupPhase } from './warmup-plan.entity';
import { WaAccountEntity, WarmupStage } from '../slots/wa-account.entity';
import { getTemplate, V1_14DAY_TEMPLATE } from './warmup-plan.templates';

@Injectable()
export class WarmupPlanService {
  private readonly logger = new Logger(WarmupPlanService.name);

  constructor(
    @InjectRepository(WarmupPlanEntity) private readonly planRepo: Repository<WarmupPlanEntity>,
    @InjectRepository(WaAccountEntity) private readonly accountRepo: Repository<WaAccountEntity>,
  ) {}

  /**
   * 账号首次激活完 QR/SMS 后调用 — 建 Day 0 plan. 幂等 (同 account 重复调不新建).
   */
  async initForAccount(accountId: number, template = V1_14DAY_TEMPLATE.id): Promise<WarmupPlanEntity> {
    const account = await this.accountRepo.findOne({ where: { id: accountId } });
    if (!account) throw new NotFoundException(`wa_account ${accountId} 不存在`);

    const existing = await this.planRepo.findOne({ where: { accountId } });
    if (existing) return existing;

    if (!getTemplate(template)) {
      throw new BadRequestException(`未知 template ${template}`);
    }
    const now = new Date();
    const plan = await this.planRepo.save(
      this.planRepo.create({
        accountId,
        template,
        currentPhase: WarmupPhase.Incubate,
        currentDay: 1,
        startedAt: now,
        lastAdvancedAt: now,
        paused: false,
        history: [{ at: now.toISOString(), event: 'start', toPhase: WarmupPhase.Incubate, toDay: 1 }],
      }),
    );
    await this.accountRepo.update({ id: accountId }, {
      warmupStage: WarmupStage.Incubation,
      warmupDay: 1,
    });
    this.logger.log(`inited warmup_plan for account ${accountId} · template=${template}`);
    return plan;
  }

  async findByAccount(accountId: number): Promise<WarmupPlanEntity | null> {
    return this.planRepo.findOne({ where: { accountId } });
  }

  async listForTenant(tenantId: number): Promise<Array<WarmupPlanEntity & { phoneNumber: string }>> {
    // 租户视角: 所有已绑账号的 plan + 手机号方便 UI 显示
    const rows = await this.planRepo
      .createQueryBuilder('p')
      .innerJoin('wa_account', 'wa', 'wa.id = p.account_id')
      .innerJoin('account_slot', 's', 's.account_id = wa.id')
      .where('s.tenant_id = :tenantId', { tenantId })
      .orderBy('s.slot_index', 'ASC')
      .select(['p.*', 'wa.phone_number AS phone_number'])
      .getRawMany<WarmupPlanEntity & { phone_number: string }>();
    return rows.map((r) => ({ ...r, phoneNumber: r.phone_number }));
  }

  async listActivePlans(): Promise<WarmupPlanEntity[]> {
    // calendar engine 用: 未暂停 + 未 Mature 也要 (Mature 走 MATURE_DAILY_WINDOWS)
    return this.planRepo.find({ where: { paused: false } });
  }
}
