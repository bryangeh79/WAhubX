import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppSettingEntity } from '../../common/app-setting.entity';

// Health module settings · 存 app_setting 表, health.* 命名空间
const KEY_DRY_RUN = 'health.dry_run';
const KEY_SCORING_WINDOW_DAYS = 'health.scoring_window_days';
const DEFAULT_WINDOW_DAYS = 30;

// Dry-run 模式 (用户 2026-04-20 必做 #3):
//   scorer 照常写 risk_level; auto-regress 不触发 · priority 降档不生效 · send_delay 不加倍
//   弹窗加 "[DRY-RUN]" 前缀
//   首次 rollout 新公式必走 72h dry-run 再开真降级
@Injectable()
export class HealthSettingsService {
  constructor(
    @InjectRepository(AppSettingEntity) private readonly repo: Repository<AppSettingEntity>,
  ) {}

  async isDryRun(): Promise<boolean> {
    const row = await this.repo.findOne({ where: { key: KEY_DRY_RUN } });
    return row?.value === 'true'; // default false
  }

  async setDryRun(enabled: boolean): Promise<boolean> {
    await this.repo.save({ key: KEY_DRY_RUN, value: enabled ? 'true' : 'false' });
    return enabled;
  }

  async getScoringWindowDays(): Promise<number> {
    const row = await this.repo.findOne({ where: { key: KEY_SCORING_WINDOW_DAYS } });
    const n = row ? parseInt(row.value, 10) : NaN;
    return Number.isFinite(n) && n > 0 && n <= 365 ? n : DEFAULT_WINDOW_DAYS;
  }

  async setScoringWindowDays(days: number): Promise<number> {
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new Error('scoring_window_days 需 1-365 整数');
    }
    await this.repo.save({ key: KEY_SCORING_WINDOW_DAYS, value: String(days) });
    return days;
  }

  async snapshot(): Promise<{ dryRun: boolean; scoringWindowDays: number }> {
    return {
      dryRun: await this.isDryRun(),
      scoringWindowDays: await this.getScoringWindowDays(),
    };
  }
}
