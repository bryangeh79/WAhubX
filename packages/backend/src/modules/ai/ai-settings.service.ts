import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppSettingEntity } from '../../common/app-setting.entity';

const KEY_TEXT_ENABLED = 'ai.text_enabled';

@Injectable()
export class AiSettingsService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(AppSettingEntity) private readonly settingRepo: Repository<AppSettingEntity>,
  ) {}

  async isTextEnabled(): Promise<boolean> {
    const row = await this.settingRepo.findOne({ where: { key: KEY_TEXT_ENABLED } });
    if (row) return row.value === 'true';
    // fallback 到 env 冷启动默认
    return this.config.get<string>('AI_TEXT_ENABLED', 'false') === 'true';
  }

  async setTextEnabled(enabled: boolean): Promise<boolean> {
    await this.settingRepo.save({ key: KEY_TEXT_ENABLED, value: enabled ? 'true' : 'false' });
    return enabled;
  }

  async snapshot(): Promise<Record<string, string>> {
    // 只返 ai.* 前缀的 settings
    const rows = await this.settingRepo
      .createQueryBuilder('s')
      .where('s.key LIKE :prefix', { prefix: 'ai.%' })
      .getMany();
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key.replace(/^ai\./, '')] = r.value;
    if (out.text_enabled === undefined) {
      out.text_enabled = this.config.get<string>('AI_TEXT_ENABLED', 'false');
    }
    return out;
  }
}
