import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppSettingEntity } from '../../common/app-setting.entity';
import { AccountSlotEntity } from '../slots/account-slot.entity';
import { WaContactEntity } from '../messaging/wa-contact.entity';
import { TaskEntity } from '../tasks/task.entity';
import { SlotsModule } from '../slots/slots.module';

import { AdvertisementEntity } from './entities/advertisement.entity';
import { OpeningLineEntity } from './entities/opening-line.entity';
import { CustomerGroupEntity } from './entities/customer-group.entity';
import { CustomerGroupMemberEntity } from './entities/customer-group-member.entity';
import { CampaignEntity } from './entities/campaign.entity';
import { CampaignRunEntity } from './entities/campaign-run.entity';
import { CampaignTargetEntity } from './entities/campaign-target.entity';

import { ThrottleProfileService } from './services/throttle-profile.service';
import { MatureSlotPickerService } from './services/mature-slot-picker.service';
import { SafetyCapacityService } from './services/safety-capacity.service';
import { AdvertisementsService } from './services/advertisements.service';
import { OpeningLinesService } from './services/opening-lines.service';
import { CustomerGroupsService } from './services/customer-groups.service';
import { CampaignExpanderService } from './services/campaign-expander.service';
import { CampaignsService } from './services/campaigns.service';
import { CampaignSchedulerService } from './services/campaign-scheduler.service';
import { ReplyAttributionService } from './services/reply-attribution.service';

import { AdvertisementsController } from './controllers/advertisements.controller';
import { OpeningLinesController } from './controllers/opening-lines.controller';
import { CustomerGroupsController } from './controllers/customer-groups.controller';
import { CampaignsController } from './controllers/campaigns.controller';
import { CampaignStateController } from './controllers/campaign-state.controller';

import { CampaignFeatureFlagGuard } from './guards/feature-flag.guard';
import { SendAdExecutor } from './executors/send-ad.executor';

// 2026-04-23 · 广告投放向导 v1 · plan rosy-dazzling-wave
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AppSettingEntity,
      AccountSlotEntity,
      WaContactEntity,
      TaskEntity,
      AdvertisementEntity,
      OpeningLineEntity,
      CustomerGroupEntity,
      CustomerGroupMemberEntity,
      CampaignEntity,
      CampaignRunEntity,
      CampaignTargetEntity,
    ]),
    SlotsModule,
  ],
  controllers: [
    AdvertisementsController,
    OpeningLinesController,
    CustomerGroupsController,
    CampaignsController,
    CampaignStateController,
  ],
  providers: [
    ThrottleProfileService,
    MatureSlotPickerService,
    SafetyCapacityService,
    AdvertisementsService,
    OpeningLinesService,
    CustomerGroupsService,
    CampaignExpanderService,
    CampaignsService,
    CampaignSchedulerService,
    ReplyAttributionService,
    CampaignFeatureFlagGuard,
    SendAdExecutor,
  ],
  exports: [SendAdExecutor, ReplyAttributionService],
})
export class CampaignsModule {}
