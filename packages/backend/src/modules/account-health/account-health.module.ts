import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RiskEventEntity } from './risk-event.entity';
import { AccountHealthEntity } from '../slots/account-health.entity';
import { AccountSlotEntity } from '../slots/account-slot.entity';
import { WaAccountEntity } from '../slots/wa-account.entity';
import { AppSettingEntity } from '../../common/app-setting.entity';
import { WarmupPlanEntity } from '../warmup/warmup-plan.entity';
import { RiskEventService } from './risk-event.service';
import { HealthScorerService } from './health-scorer.service';
import { HealthSettingsService } from './health-settings.service';
import { HealthCoordinatorService } from './health-coordinator.service';
import { AlertDispatcherService } from './alert-dispatcher.service';
import { DesktopAlertChannel } from './desktop-alert.channel';
import { ALERT_CHANNELS } from './alert-channel';
import { AccountHealthController } from './account-health.controller';
import { WarmupModule } from '../warmup/warmup.module';

// Global · 让 DispatcherService (M3) 可以直接 inject HealthSettingsService + HealthScorerService
// 避免 TasksModule 反向 import AccountHealthModule 形成循环
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      RiskEventEntity,
      AccountHealthEntity,
      AccountSlotEntity,
      WaAccountEntity,
      AppSettingEntity,
      WarmupPlanEntity,
    ]),
    WarmupModule, // WarmupPhaseService 给 coordinator 调用 maybeRegress
  ],
  controllers: [AccountHealthController],
  providers: [
    RiskEventService,
    HealthScorerService,
    HealthSettingsService,
    HealthCoordinatorService,
    AlertDispatcherService,
    DesktopAlertChannel,
    {
      provide: ALERT_CHANNELS,
      useFactory: (desktop: DesktopAlertChannel) => [desktop],
      inject: [DesktopAlertChannel],
    },
  ],
  exports: [
    RiskEventService,
    HealthScorerService,
    HealthSettingsService,
    AlertDispatcherService,
  ],
})
export class AccountHealthModule {}
