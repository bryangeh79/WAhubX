import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ThrottleProfileService } from '../services/throttle-profile.service';

// 2026-04-23 · 广告投放模块总开关 · plan §H Feature Flag
// app_setting 'campaign.module_enabled' = 'true' 时才允许访问所有 /api/campaigns·/api/customer-groups·/api/advertisements·/api/opening-lines
// 默认 false → 关的时候返 503 (不是 403 · 因为不是权限问题, 是功能未启用)

@Injectable()
export class CampaignFeatureFlagGuard implements CanActivate {
  constructor(private readonly throttle: ThrottleProfileService) {}

  async canActivate(_context: ExecutionContext): Promise<boolean> {
    const enabled = await this.throttle.isModuleEnabled();
    if (!enabled) {
      throw new ServiceUnavailableException({
        message: '广告投放模块未启用',
        detail: '请联系管理员开启 app_setting campaign.module_enabled',
        code: 'CAMPAIGN_MODULE_DISABLED',
      });
    }
    return true;
  }
}
