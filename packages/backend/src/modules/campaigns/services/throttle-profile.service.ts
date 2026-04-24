import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppSettingEntity } from '../../../common/app-setting.entity';
import { ThrottleProfile } from '../entities/campaign.entity';

// 2026-04-23 · 节流档位参数读取 · plan §F
// 档位 3 档 · 每档 3 个参数: daily_cap / windows / gap_sec
// app_setting key 格式: campaign.throttle.<profile>.<field>

export interface ThrottleWindow {
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
}

export interface ThrottleParams {
  dailyCap: number;
  windows: ThrottleWindow[];
  gapSec: [number, number]; // [min, max] 秒
}

const PROFILE_KEY: Record<ThrottleProfile, string> = {
  [ThrottleProfile.Conservative]: 'conservative',
  [ThrottleProfile.Balanced]: 'balanced',
  [ThrottleProfile.Aggressive]: 'aggressive',
};

const FEATURE_FLAG_KEY = 'campaign.module_enabled';
const DEFAULT_HORIZON_KEY = 'campaign.default_horizon_days';

@Injectable()
export class ThrottleProfileService {
  private readonly logger = new Logger(ThrottleProfileService.name);

  constructor(
    @InjectRepository(AppSettingEntity)
    private readonly settingRepo: Repository<AppSettingEntity>,
  ) {}

  async isModuleEnabled(): Promise<boolean> {
    const row = await this.settingRepo.findOne({ where: { key: FEATURE_FLAG_KEY } });
    if (!row) return false;
    return row.value === 'true';
  }

  async getDefaultHorizonDays(): Promise<number> {
    const row = await this.settingRepo.findOne({ where: { key: DEFAULT_HORIZON_KEY } });
    if (!row) return 7;
    const n = Number(row.value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 7;
  }

  async get(profile: ThrottleProfile): Promise<ThrottleParams> {
    const key = PROFILE_KEY[profile];
    if (!key) {
      this.logger.warn(`unknown throttle profile ${profile}, fallback to conservative`);
      return this.get(ThrottleProfile.Conservative);
    }
    const [dailyCap, windows, gapSec] = await Promise.all([
      this.getInt(`campaign.throttle.${key}.daily_cap`, 20),
      this.getJson<Array<[string, string]>>(`campaign.throttle.${key}.windows`, [
        ['10:00', '12:00'],
        ['14:00', '17:00'],
        ['19:00', '22:00'],
      ]),
      this.getJson<[number, number]>(`campaign.throttle.${key}.gap_sec`, [40, 120]),
    ]);
    return {
      dailyCap,
      windows: windows.map(([start, end]) => ({ start, end })),
      gapSec,
    };
  }

  private async getInt(key: string, fallback: number): Promise<number> {
    const row = await this.settingRepo.findOne({ where: { key } });
    if (!row) return fallback;
    const n = Number(row.value);
    return Number.isFinite(n) ? Math.floor(n) : fallback;
  }

  private async getJson<T>(key: string, fallback: T): Promise<T> {
    const row = await this.settingRepo.findOne({ where: { key } });
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      this.logger.warn(`app_setting ${key} is not valid JSON, using fallback`);
      return fallback;
    }
  }

  // 判断某个时间点是否在任一窗口内
  isWithinWindows(date: Date, windows: ThrottleWindow[]): boolean {
    const mins = date.getHours() * 60 + date.getMinutes();
    for (const w of windows) {
      const [sh, sm] = w.start.split(':').map(Number);
      const [eh, em] = w.end.split(':').map(Number);
      const s = sh * 60 + sm;
      const e = eh * 60 + em;
      if (mins >= s && mins < e) return true;
    }
    return false;
  }

  // 找 "下一个窗口开始时刻" — 同天 or 次日
  nextWindowStart(from: Date, windows: ThrottleWindow[]): Date {
    const nowMins = from.getHours() * 60 + from.getMinutes();
    // 同天
    for (const w of windows) {
      const [sh, sm] = w.start.split(':').map(Number);
      const s = sh * 60 + sm;
      if (s > nowMins) {
        const next = new Date(from);
        next.setHours(sh, sm, 0, 0);
        return next;
      }
    }
    // 次日第一个窗口
    const [sh, sm] = windows[0].start.split(':').map(Number);
    const next = new Date(from);
    next.setDate(next.getDate() + 1);
    next.setHours(sh, sm, 0, 0);
    return next;
  }
}
