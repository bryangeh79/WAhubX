import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { GroupWarmupPlanEntity } from './group-warmup-plan.entity';
import { ExecutionGroupEntity } from '../execution-groups/execution-group.entity';
import { WarmupPlanEntity, WarmupPhase } from './warmup-plan.entity';
import { WarmupPairPicker } from './warmup-pair-picker.service';
import { getTemplate } from './warmup-plan.templates';

// 2026-04-22 · Group-based 养号计划 CRUD + 生命周期
@Injectable()
export class GroupWarmupService {
  private readonly logger = new Logger(GroupWarmupService.name);

  constructor(
    @InjectRepository(GroupWarmupPlanEntity)
    private readonly planRepo: Repository<GroupWarmupPlanEntity>,
    @InjectRepository(ExecutionGroupEntity)
    private readonly groupRepo: Repository<ExecutionGroupEntity>,
    private readonly pairPicker: WarmupPairPicker,
    private readonly dataSource: DataSource,
  ) {}

  async listForTenant(tenantId: number | null): Promise<GroupWarmupPlanEntity[]> {
    const qb = this.planRepo
      .createQueryBuilder('p')
      .leftJoinAndSelect('p.group', 'g');
    if (tenantId !== null) qb.where('g.tenant_id = :tid', { tid: tenantId });
    return qb.orderBy('p.id', 'DESC').getMany();
  }

  /** 启动 · 给一个执行组跑养号 */
  async start(
    groupId: number,
    tenantId: number | null,
    template = 'v1_7day',
  ): Promise<GroupWarmupPlanEntity> {
    const group = await this.groupRepo.findOne({
      where: { id: groupId },
      relations: ['slots'],
    });
    if (!group) throw new NotFoundException(`执行组 ${groupId} 不存在`);
    if (tenantId !== null && group.tenantId !== tenantId) {
      throw new ForbiddenException('无权限');
    }
    if (!getTemplate(template)) {
      throw new BadRequestException(`模板 ${template} 不存在`);
    }
    const exist = await this.planRepo.findOne({ where: { groupId } });
    if (exist) {
      throw new BadRequestException(`该组已有养号计划 (id=${exist.id} · paused=${exist.paused})`);
    }
    // 成员数 ≥ 2 (script_chat 硬规则)
    const active = (group.slots ?? []).filter((s) => s.accountId !== null);
    if (active.length < 2) {
      throw new BadRequestException(`执行组成员 < 2 个活跃号 · script_chat 需要 ≥ 2 号`);
    }

    const plan = this.planRepo.create({
      groupId,
      template,
      currentDay: 1,
      currentPhase: WarmupPhase.Incubate,
      startedAt: new Date(),
      paused: false,
      lastPairHistory: [],
    });
    const saved = await this.planRepo.save(plan);

    // 给每个成员创建/关联 per-account warmup_plan 并设 group_plan_id
    await this.dataSource.transaction(async (m) => {
      for (const slot of active) {
        if (!slot.accountId) continue;
        let wp = await m.findOne(WarmupPlanEntity, { where: { accountId: slot.accountId } });
        if (!wp) {
          wp = m.create(WarmupPlanEntity, {
            accountId: slot.accountId,
            template,
            currentDay: 1,
            currentPhase: WarmupPhase.Incubate,
            startedAt: new Date(),
            paused: false,
          });
        }
        (wp as unknown as { groupPlanId: number }).groupPlanId = saved.id;
        await m.save(wp);
      }
    });

    this.logger.log(
      `group warmup started · group=${groupId} members=${active.length} template=${template} plan_id=${saved.id}`,
    );
    return saved;
  }

  async pause(planId: number, tenantId: number | null): Promise<GroupWarmupPlanEntity> {
    const plan = await this.loadAndCheck(planId, tenantId);
    plan.paused = true;
    return this.planRepo.save(plan);
  }

  async resume(planId: number, tenantId: number | null): Promise<GroupWarmupPlanEntity> {
    const plan = await this.loadAndCheck(planId, tenantId);
    plan.paused = false;
    return this.planRepo.save(plan);
  }

  /** 2026-04-22 · 开启成熟运营期 · Day 15+ */
  async startMature(
    planId: number,
    tenantId: number | null,
    level: 'light' | 'standard' | 'aggressive',
  ): Promise<GroupWarmupPlanEntity> {
    const plan = await this.loadAndCheck(planId, tenantId);
    if (plan.currentDay < 8) {
      throw new BadRequestException(`当前 Day ${plan.currentDay} · 成熟运营需 Day 15+ · 请先完成养号/热身`);
    }
    plan.matureLevel = level;
    plan.paused = false;
    return this.planRepo.save(plan);
  }

  /** 停止成熟运营 (回到手动) */
  async stopMature(planId: number, tenantId: number | null): Promise<GroupWarmupPlanEntity> {
    const plan = await this.loadAndCheck(planId, tenantId);
    plan.matureLevel = null;
    plan.paused = true;
    return this.planRepo.save(plan);
  }

  /** 终止 · 保留历史 · 把关联的 per-account plan.group_plan_id 解除 */
  async stop(planId: number, tenantId: number | null): Promise<void> {
    const plan = await this.loadAndCheck(planId, tenantId);
    await this.dataSource.transaction(async (m) => {
      await m
        .createQueryBuilder()
        .update(WarmupPlanEntity)
        .set({ groupPlanId: null } as unknown as Partial<WarmupPlanEntity>)
        .where('group_plan_id = :pid', { pid: plan.id })
        .execute();
      await m.delete(GroupWarmupPlanEntity, plan.id);
    });
    this.logger.log(`group warmup stopped · plan=${planId}`);
  }

  /** 调度器调 · 给今日此组选 pairs (不落库 · 返回给 calendar) */
  async pickPairsForToday(
    planId: number,
    maxPairs?: number,
  ): Promise<Array<[number, number]>> {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) return [];
    const group = await this.groupRepo.findOne({
      where: { id: plan.groupId },
      relations: ['slots'],
    });
    if (!group) return [];
    const members = (group.slots ?? [])
      .filter((s) => s.accountId !== null)
      .map((s) => s.accountId!) as number[];
    return this.pairPicker.pickPairs(members, plan.lastPairHistory ?? [], { maxPairs });
  }

  /** 落库 · 把选出的 pairs 追加到 history */
  async recordPairs(planId: number, pairs: Array<[number, number]>): Promise<void> {
    const plan = await this.planRepo.findOne({ where: { id: planId } });
    if (!plan) return;
    plan.lastPairHistory = this.pairPicker.appendToHistory(
      plan.lastPairHistory ?? [],
      plan.currentDay,
      pairs,
    );
    await this.planRepo.save(plan);
  }

  private async loadAndCheck(
    planId: number,
    tenantId: number | null,
  ): Promise<GroupWarmupPlanEntity> {
    const plan = await this.planRepo.findOne({
      where: { id: planId },
      relations: ['group'],
    });
    if (!plan) throw new NotFoundException(`养号计划 ${planId} 不存在`);
    if (tenantId !== null && plan.group?.tenantId !== tenantId) {
      throw new ForbiddenException('无权限');
    }
    return plan;
  }
}

