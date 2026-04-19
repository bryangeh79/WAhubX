import type { Repository } from 'typeorm';
import { HealthSettingsService } from './health-settings.service';
import type { AppSettingEntity } from '../../common/app-setting.entity';

function buildSvc(initial: Array<Partial<AppSettingEntity>> = []) {
  const rows = [...initial];
  const repo = {
    findOne: async ({ where: { key } }: { where: { key: string } }) =>
      rows.find((r) => r.key === key) as AppSettingEntity | undefined,
    save: async (e: Partial<AppSettingEntity>) => {
      const idx = rows.findIndex((r) => r.key === e.key);
      if (idx >= 0) rows[idx] = { ...rows[idx], ...e };
      else rows.push(e);
      return e as AppSettingEntity;
    },
  } as unknown as Repository<AppSettingEntity>;
  return { svc: new HealthSettingsService(repo), rows };
}

describe('HealthSettingsService', () => {
  it('dry_run 默认 false', async () => {
    const { svc } = buildSvc();
    expect(await svc.isDryRun()).toBe(false);
  });

  it('setDryRun(true) 后 isDryRun=true', async () => {
    const { svc } = buildSvc();
    await svc.setDryRun(true);
    expect(await svc.isDryRun()).toBe(true);
  });

  it('scoring_window_days 默认 30', async () => {
    const { svc } = buildSvc();
    expect(await svc.getScoringWindowDays()).toBe(30);
  });

  it('setScoringWindowDays 1-365 合法', async () => {
    const { svc } = buildSvc();
    await svc.setScoringWindowDays(60);
    expect(await svc.getScoringWindowDays()).toBe(60);
  });

  it('setScoringWindowDays 0/366/非整数 抛错', async () => {
    const { svc } = buildSvc();
    await expect(svc.setScoringWindowDays(0)).rejects.toThrow();
    await expect(svc.setScoringWindowDays(366)).rejects.toThrow();
    await expect(svc.setScoringWindowDays(1.5)).rejects.toThrow();
  });

  it('无效 stored value 降级默认 30', async () => {
    const { svc } = buildSvc([{ key: 'health.scoring_window_days', value: 'not-a-number' }]);
    expect(await svc.getScoringWindowDays()).toBe(30);
  });

  it('snapshot 返 dryRun + scoringWindowDays', async () => {
    const { svc } = buildSvc();
    await svc.setDryRun(true);
    await svc.setScoringWindowDays(45);
    const s = await svc.snapshot();
    expect(s).toEqual({ dryRun: true, scoringWindowDays: 45 });
  });
});
