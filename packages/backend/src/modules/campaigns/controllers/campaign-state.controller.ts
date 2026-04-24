import { Controller, Get } from '@nestjs/common';
import { ThrottleProfileService } from '../services/throttle-profile.service';

// 2026-04-23 · 公开状态查询 · 不挂 feature-flag guard
// 前端登录后读一次 · 决定是否显示"广告投放"顶部 tab
@Controller({ path: 'campaign-state', version: '1' })
export class CampaignStateController {
  constructor(private readonly throttle: ThrottleProfileService) {}

  @Get('module-enabled')
  async moduleEnabled(): Promise<{ enabled: boolean }> {
    return { enabled: await this.throttle.isModuleEnabled() };
  }
}
