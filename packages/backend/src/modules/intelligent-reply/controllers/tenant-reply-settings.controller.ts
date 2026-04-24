import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
} from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../../auth/decorators/current-user.decorator';
import { TenantReplySettingsService } from '../services/tenant-reply-settings.service';
import type { ReplyMode } from '../entities/tenant-reply-settings.entity';

@Controller({ path: 'reply-settings', version: '1' })
export class TenantReplySettingsController {
  constructor(private readonly service: TenantReplySettingsService) {}

  private tenantOf(cur: RequestUser): number {
    if (cur.tenantId === null) throw new BadRequestException('请切换到租户视角');
    return cur.tenantId;
  }

  @Get()
  get(@CurrentUser() cur: RequestUser) {
    return this.service.get(this.tenantOf(cur));
  }

  @Patch()
  update(
    @CurrentUser() cur: RequestUser,
    @Body()
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
  ) {
    return this.service.update(this.tenantOf(cur), dto);
  }
}
