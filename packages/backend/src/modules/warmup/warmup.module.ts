import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WarmupPlanEntity } from './warmup-plan.entity';
import { GroupWarmupPlanEntity } from './group-warmup-plan.entity';
import { TaskEntity } from '../tasks/task.entity';
import { AccountSlotEntity } from '../slots/account-slot.entity';
import { WaAccountEntity } from '../slots/wa-account.entity';
import { AccountHealthEntity } from '../slots/account-health.entity';
import { ExecutionGroupEntity } from '../execution-groups/execution-group.entity';
import { ScriptEntity } from '../scripts/script.entity';
import { ScriptPackEntity } from '../scripts/script-pack.entity';
import { AssetEntity } from '../scripts/asset.entity';
import { WarmupPlanService } from './warmup-plan.service';
import { WarmupPhaseService } from './warmup-phase.service';
import { WarmupPairService } from './warmup-pair.service';
import { WarmupPairPicker } from './warmup-pair-picker.service';
import { WarmupCalendarService } from './warmup-calendar.service';
import { GroupWarmupService } from './group-warmup.service';
import { WarmupExecutor } from '../tasks/executors/warmup.executor';
import { StatusPostExecutor } from './status-post.executor';
import { StatusBrowseExecutor } from './status-browse.executor';
import { WarmupController } from './warmup.controller';
import { GroupWarmupController } from './group-warmup.controller';
import { StatusPostSeedsController } from './status-post-seeds.controller';
import { AdminDebugController } from './admin-debug.controller';
import { SlotsModule } from '../slots/slots.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WarmupPlanEntity,
      GroupWarmupPlanEntity,
      TaskEntity,
      AccountSlotEntity,
      WaAccountEntity,
      AccountHealthEntity,
      ExecutionGroupEntity,
      ScriptEntity,
      ScriptPackEntity,
      AssetEntity,
    ]),
    SlotsModule,
  ],
  controllers: [WarmupController, GroupWarmupController, StatusPostSeedsController, AdminDebugController],
  providers: [
    WarmupPlanService,
    WarmupPhaseService,
    WarmupPairService,
    WarmupPairPicker,
    WarmupCalendarService,
    GroupWarmupService,
    WarmupExecutor,
    StatusPostExecutor,
    StatusBrowseExecutor,
  ],
  exports: [
    WarmupPlanService,
    WarmupPhaseService,
    WarmupPairService,
    WarmupPairPicker,
    WarmupCalendarService,
    GroupWarmupService,
    WarmupExecutor,
    StatusPostExecutor,
    StatusBrowseExecutor,
  ],
})
export class WarmupModule {}
