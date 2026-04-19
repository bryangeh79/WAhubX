import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiSettingEntity } from './ai-setting.entity';

@Injectable()
export class AiSettingsService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(AiSettingEntity) private readonly settingRepo: Repository<AiSettingEntity>,
  ) {}

  async isTextEnabled(): Promise<boolean> {
    const row = await this.settingRepo.findOne({ where: { key: 'text_enabled' } });
    if (row) return row.value === 'true';
    // fallback 到 env 冷启动默认
    return this.config.get<string>('AI_TEXT_ENABLED', 'false') === 'true';
  }

  async setTextEnabled(enabled: boolean): Promise<boolean> {
    await this.settingRepo.save({ key: 'text_enabled', value: enabled ? 'true' : 'false' });
    return enabled;
  }

  async snapshot(): Promise<Record<string, string>> {
    const rows = await this.settingRepo.find();
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    // 缺省字段补 env
    if (out.text_enabled === undefined) {
      out.text_enabled = this.config.get<string>('AI_TEXT_ENABLED', 'false');
    }
    return out;
  }
}
