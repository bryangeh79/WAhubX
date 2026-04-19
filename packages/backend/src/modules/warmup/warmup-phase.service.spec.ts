import type { Repository } from 'typeorm';
import { WarmupPhaseService } from './warmup-phase.service';
import { WarmupPlanEntity, WarmupPhase } from './warmup-plan.entity';
import type { WaAccountEntity } from '../slots/wa-account.entity';
import { RiskLevel, type AccountHealthEntity } from '../slots/account-health.entity';
import { V1_14DAY_TEMPLATE } from './warmup-plan.templates';

function buildSvc(opts: {
  plan: Partial<WarmupPlanEntity>;
  riskLevel?: RiskLevel;
} = { plan: {} }) {
  const plans = new Map<number, Partial<WarmupPlanEntity>>();
  const plan: Partial<WarmupPlanEntity> = {
    id: 1,
    accountId: 100,
    template: 'v1_14day',
    currentPhase: 0,
    currentDay: 1,
    paused: false,
    startedAt: new Date('2026-04-01T00:00:00Z'),
    lastAdvancedAt: new Date('2026-04-01T00:00:00Z'),
    regressedAt: null,
    regressReason: null,
    history: [],
    ...opts.plan,
  };
  plans.set(plan.id!, plan);

  const accountUpdates: Array<{ id: number; patch: Record<string, unknown> }> = [];

  const planRepo = {
    findOne: async ({ where: { id } }: { where: { id: number } }) => plans.get(id),
    save: async (e: Partial<WarmupPlanEntity>) => {
      plans.set(e.id!, { ...plans.get(e.id!)!, ...e });
      return e as WarmupPlanEntity;
    },
  } as unknown as Repository<WarmupPlanEntity>;

  const accountRepo = {
    update: async ({ id }: { id: number }, patch: Record<string, unknown>) => {
      accountUpdates.push({ id, patch });
      return { affected: 1 };
    },
  } as unknown as Repository<WaAccountEntity>;

  const healthRepo = {
    findOne: async () =>
      opts.riskLevel
        ? ({ riskLevel: opts.riskLevel, healthScore: 20 } as AccountHealthEntity)
        : null,
  } as unknown as Repository<AccountHealthEntity>;

  return {
    svc: new WarmupPhaseService(planRepo, accountRepo, healthRepo),
    plan,
    plans,
    accountUpdates,
  };
}

describe('WarmupPhaseService.computePhaseForDay', () => {
  it('maps day ranges to phase thresholds', () => {
    const { svc } = buildSvc();
    const t = V1_14DAY_TEMPLATE.phaseThresholds;
    expect(svc.computePhaseForDay(1, t)).toBe(WarmupPhase.Incubate);
    expect(svc.computePhaseForDay(3, t)).toBe(WarmupPhase.Incubate);
    expect(svc.computePhaseForDay(4, t)).toBe(WarmupPhase.Preheat);
    expect(svc.computePhaseForDay(7, t)).toBe(WarmupPhase.Preheat);
    expect(svc.computePhaseForDay(8, t)).toBe(WarmupPhase.Activate);
    expect(svc.computePhaseForDay(14, t)).toBe(WarmupPhase.Activate);
    expect(svc.computePhaseForDay(15, t)).toBe(WarmupPhase.Mature);
    expect(svc.computePhaseForDay(30, t)).toBe(WarmupPhase.Mature);
  });
});

describe('WarmupPhaseService.tickDay · 推进边界', () => {
  it('day 3→4 跨阈值升 Phase 0→1', async () => {
    const { svc, plan, accountUpdates } = buildSvc({
      plan: { currentPhase: WarmupPhase.Incubate, currentDay: 3 },
    });
    await svc.tickDay(plan.id!);
    expect(plan.currentDay).toBe(4);
    expect(plan.currentPhase).toBe(WarmupPhase.Preheat);
    expect(plan.history?.some((h) => h.event === 'advance')).toBe(true);
    // wa_account.warmup_stage 同步
    expect(accountUpdates.find((u) => u.patch.warmupStage === WarmupPhase.Preheat)).toBeDefined();
  });

  it('day 7→8 升 Phase 1→2 (首个允许 status_post)', async () => {
    const { svc, plan } = buildSvc({
      plan: { currentPhase: WarmupPhase.Preheat, currentDay: 7 },
    });
    await svc.tickDay(plan.id!);
    expect(plan.currentDay).toBe(8);
    expect(plan.currentPhase).toBe(WarmupPhase.Activate);
  });

  it('day 14→15 升 Phase 2→3 (Mature)', async () => {
    const { svc, plan } = buildSvc({
      plan: { currentPhase: WarmupPhase.Activate, currentDay: 14 },
    });
    await svc.tickDay(plan.id!);
    expect(plan.currentDay).toBe(15);
    expect(plan.currentPhase).toBe(WarmupPhase.Mature);
  });

  it('day 5→6 同 phase 不触发 advance 事件', async () => {
    const { svc, plan } = buildSvc({
      plan: { currentPhase: WarmupPhase.Preheat, currentDay: 5, history: [] },
    });
    await svc.tickDay(plan.id!);
    expect(plan.currentPhase).toBe(WarmupPhase.Preheat);
    expect(plan.history?.filter((h) => h.event === 'advance')).toHaveLength(0);
  });

  it('paused 状态不推 day', async () => {
    const { svc, plan } = buildSvc({
      plan: { paused: true, currentDay: 5 },
    });
    await svc.tickDay(plan.id!);
    expect(plan.currentDay).toBe(5); // 未动
  });
});

describe('WarmupPhaseService.maybeRegress · health 退回 Phase 0', () => {
  it('risk_level=high → 强制 Phase 0 · day=1 · 记 reason', async () => {
    const { svc, plan } = buildSvc({
      plan: { currentPhase: WarmupPhase.Activate, currentDay: 10 },
      riskLevel: RiskLevel.High,
    });
    const regressed = await svc.maybeRegress(plan as WarmupPlanEntity);
    expect(regressed).toBe(true);
    expect(plan.currentPhase).toBe(WarmupPhase.Incubate);
    expect(plan.currentDay).toBe(1);
    expect(plan.regressReason).toContain('risk_level=high');
    expect(plan.regressedAt).toBeTruthy();
    expect(plan.history?.some((h) => h.event === 'regress')).toBe(true);
  });

  it('risk_level=medium 不触发 regress', async () => {
    const { svc, plan } = buildSvc({
      plan: { currentPhase: WarmupPhase.Activate, currentDay: 10 },
      riskLevel: RiskLevel.Medium,
    });
    const regressed = await svc.maybeRegress(plan as WarmupPlanEntity);
    expect(regressed).toBe(false);
    expect(plan.currentPhase).toBe(WarmupPhase.Activate);
  });

  it('risk_level=low 不触发 regress', async () => {
    const { svc, plan } = buildSvc({
      plan: { currentPhase: WarmupPhase.Preheat, currentDay: 6 },
      riskLevel: RiskLevel.Low,
    });
    const regressed = await svc.maybeRegress(plan as WarmupPlanEntity);
    expect(regressed).toBe(false);
  });

  it('已在 Phase 0 day 1 不重复 regress', async () => {
    const { svc, plan } = buildSvc({
      plan: { currentPhase: WarmupPhase.Incubate, currentDay: 1 },
      riskLevel: RiskLevel.High,
    });
    const regressed = await svc.maybeRegress(plan as WarmupPlanEntity);
    expect(regressed).toBe(false);
  });

  it('无 health 行视为 low, 不 regress', async () => {
    const { svc, plan } = buildSvc({
      plan: { currentPhase: WarmupPhase.Activate, currentDay: 10 },
      // riskLevel 未设 → healthRepo.findOne 返 null
    });
    const regressed = await svc.maybeRegress(plan as WarmupPlanEntity);
    expect(regressed).toBe(false);
  });
});

describe('WarmupPhaseService.skipToNextPhase', () => {
  it('Phase 1 · day 5 → skip 到 Phase 2 · day=threshold(Activate)=8', async () => {
    const { svc, plan, accountUpdates } = buildSvc({
      plan: { currentPhase: WarmupPhase.Preheat, currentDay: 5 },
    });
    await svc.skipToNextPhase(plan.id!, 'dev test');
    expect(plan.currentPhase).toBe(WarmupPhase.Activate);
    expect(plan.currentDay).toBe(V1_14DAY_TEMPLATE.phaseThresholds[WarmupPhase.Activate]);
    expect(plan.history?.some((h) => h.event === 'skip' && h.reason === 'dev test')).toBe(true);
    expect(accountUpdates.find((u) => u.patch.warmupStage === WarmupPhase.Activate)).toBeDefined();
  });

  it('Phase 3 (Mature) 已到顶 → 抛', async () => {
    const { svc, plan } = buildSvc({
      plan: { currentPhase: WarmupPhase.Mature, currentDay: 20 },
    });
    await expect(svc.skipToNextPhase(plan.id!, 'x')).rejects.toThrow(/Mature/);
  });
});
