// Stub baileys 不被拉进来
jest.mock('../baileys/baileys.service', () => ({ BaileysService: class {} }));

import type { Repository } from 'typeorm';
import { HealthCoordinatorService } from './health-coordinator.service';
import { RiskEventService } from './risk-event.service';
import { HealthScorerService } from './health-scorer.service';
import { HealthSettingsService } from './health-settings.service';
import { AlertDispatcherService } from './alert-dispatcher.service';
import { WarmupPhaseService } from '../warmup/warmup-phase.service';
import type { WarmupPlanEntity } from '../warmup/warmup-plan.entity';
import { RiskLevel } from '../slots/account-health.entity';

// 构造所有依赖 stub · 测 debounce / dry_run / regress 触发逻辑
function buildCoordinator(opts: {
  riskLevel: RiskLevel;
  dryRun?: boolean;
  regressed?: boolean;
}) {
  const alerts: Array<{ title: string; dryRun?: boolean }> = [];
  const regressCalls: number[] = [];

  const events = {
    record: jest.fn().mockResolvedValue({ inserted: true }),
  } as unknown as RiskEventService;
  const scorer = {
    rescore: jest.fn().mockResolvedValue({
      accountId: 42,
      score: opts.riskLevel === 'low' ? 80 : opts.riskLevel === 'medium' ? 45 : 20,
      riskLevel: opts.riskLevel,
      breakdown: [],
      windowDays: 30,
      computedAt: new Date(),
    }),
  } as unknown as HealthScorerService;
  const settings = {
    isDryRun: jest.fn().mockResolvedValue(!!opts.dryRun),
  } as unknown as HealthSettingsService;
  const alertDispatcher = {
    dispatch: jest.fn(async (p: { title: string; dryRun?: boolean }) => {
      alerts.push(p);
    }),
  } as unknown as AlertDispatcherService;
  const phaseService = {
    maybeRegress: jest.fn(async (_p: WarmupPlanEntity) => {
      regressCalls.push(Date.now());
      return opts.regressed ?? true;
    }),
  } as unknown as WarmupPhaseService;
  const planRepo = {
    findOne: async () => ({ id: 1, accountId: 42, currentPhase: 2 } as unknown as WarmupPlanEntity),
    find: async () => [] as WarmupPlanEntity[],
  } as unknown as Repository<WarmupPlanEntity>;

  return {
    coord: new HealthCoordinatorService(events, scorer, settings, alertDispatcher, phaseService, planRepo),
    alerts,
    regressCalls,
    mocks: { events, scorer, settings, alertDispatcher, phaseService },
  };
}

describe('HealthCoordinatorService · debounce + dry_run', () => {
  it('low 级别不做任何降级动作', async () => {
    const { coord, alerts, regressCalls } = buildCoordinator({ riskLevel: RiskLevel.Low });
    await coord.handleRaw({
      accountId: 42, code: 'captcha_triggered', severity: 'info', source: 'test',
    });
    expect(alerts).toHaveLength(0);
    expect(regressCalls).toHaveLength(0);
  });

  it('第一次进 high · 记 debounce 起点 · 只 warn 不 regress', async () => {
    const { coord, alerts, regressCalls } = buildCoordinator({ riskLevel: RiskLevel.High });
    await coord.handleRaw({
      accountId: 42, code: 'banned_by_wa', severity: 'critical', source: 'baileys',
    });
    expect(regressCalls).toHaveLength(0);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toContain('风险升高');
  });

  it('debounce 未满 (< 30min) · 再次 rescore 不 regress', async () => {
    const { coord, regressCalls } = buildCoordinator({ riskLevel: RiskLevel.High });
    await coord.handleRaw({ accountId: 42, code: 'x', severity: 'info', source: 's' });
    await coord.handleRaw({ accountId: 42, code: 'y', severity: 'info', source: 's' });
    expect(regressCalls).toHaveLength(0);
  });

  it('debounce 过期 (> 30min) · 触发 regress', async () => {
    const { coord, regressCalls } = buildCoordinator({ riskLevel: RiskLevel.High });
    // 第一次进 high (时钟 t0)
    jest.useFakeTimers().setSystemTime(new Date('2026-04-20T00:00:00Z'));
    await coord.handleRaw({ accountId: 42, code: 'a', severity: 'info', source: 's' });
    expect(regressCalls).toHaveLength(0);

    // t0 + 31 分钟, 再次 rescore (仍 high)
    jest.setSystemTime(new Date('2026-04-20T00:31:00Z'));
    await coord.handleRaw({ accountId: 42, code: 'b', severity: 'info', source: 's' });
    expect(regressCalls).toHaveLength(1);
    jest.useRealTimers();
  });

  it('debounce 期间退出 high · 清状态 · 下一次进 high 重新计时', async () => {
    const { coord, mocks, regressCalls } = buildCoordinator({ riskLevel: RiskLevel.High });
    jest.useFakeTimers().setSystemTime(new Date('2026-04-20T00:00:00Z'));
    await coord.handleRaw({ accountId: 42, code: 'a', severity: 'info', source: 's' });

    // 20 分钟后 退回 low
    (mocks.scorer.rescore as jest.Mock).mockResolvedValueOnce({
      accountId: 42, score: 80, riskLevel: RiskLevel.Low, breakdown: [], windowDays: 30, computedAt: new Date(),
    });
    jest.setSystemTime(new Date('2026-04-20T00:20:00Z'));
    await coord.handleRaw({ accountId: 42, code: 'b', severity: 'info', source: 's' });

    // 又过 15 分钟 重新进 high (累计时钟 35min 但 debounce 应从此刻起算, 不算总计)
    jest.setSystemTime(new Date('2026-04-20T00:35:00Z'));
    await coord.handleRaw({ accountId: 42, code: 'c', severity: 'info', source: 's' });
    expect(regressCalls).toHaveLength(0); // 还没到 debounce

    jest.useRealTimers();
  });

  it('DRY-RUN 模式 · 持续 high 30min 不触发真 regress, 只发告警 + 日志', async () => {
    const { coord, alerts, regressCalls } = buildCoordinator({ riskLevel: RiskLevel.High, dryRun: true });
    jest.useFakeTimers().setSystemTime(new Date('2026-04-20T00:00:00Z'));
    await coord.handleRaw({ accountId: 42, code: 'a', severity: 'info', source: 's' });
    jest.setSystemTime(new Date('2026-04-20T00:31:00Z'));
    await coord.handleRaw({ accountId: 42, code: 'b', severity: 'info', source: 's' });
    expect(regressCalls).toHaveLength(0); // DRY-RUN 不真 regress
    // 两个告警: 首次 + debounce 到期
    expect(alerts).toHaveLength(2);
    expect(alerts.every((a) => a.dryRun === true)).toBe(true);
    jest.useRealTimers();
  });
});
