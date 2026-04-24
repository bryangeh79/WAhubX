import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ReplyMode,
  TenantReplySettingsEntity,
} from '../entities/tenant-reply-settings.entity';

@Injectable()
export class TenantReplySettingsService {
  constructor(
    @InjectRepository(TenantReplySettingsEntity)
    private readonly repo: Repository<TenantReplySettingsEntity>,
  ) {}

  async get(tenantId: number): Promise<TenantReplySettingsEntity> {
    let row = await this.repo.findOne({ where: { tenantId } });
    if (!row) {
      row = await this.repo.save(
        this.repo.create({
          tenantId,
          mode: 'off',
          defaultKbId: null,
          dailyAiReplyLimit: 200,
          quietHoursEnabled: false,
          quietHoursStart: '22:00',
          quietHoursEnd: '08:00',
          blacklistKeywords: [],
          customHandoffKeywords: [],
        }),
      );
    }
    return row;
  }

  async update(
    tenantId: number,
    dto: Partial<{
      mode: ReplyMode;
      defaultKbId: number | null;
      dailyAiReplyLimit: number;
      quietHoursEnabled: boolean;
      quietHoursStart: string;
      quietHoursEnd: string;
      blacklistKeywords: string[];
      customHandoffKeywords: string[];
    }>,
  ): Promise<TenantReplySettingsEntity> {
    const row = await this.get(tenantId);
    Object.assign(row, dto);
    return this.repo.save(row);
  }
}
