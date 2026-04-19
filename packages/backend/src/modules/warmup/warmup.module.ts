import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WarmupPlanEntity } from './warmup-plan.entity';
import { TaskEntity } from '../tasks/task.entity';
import { AccountSlotEntity } from '../slots/account-slot.entity';
import { WaAccountEntity } from '../slots/wa-account.entity';
import { AccountHealthEntity } from '../slots/account-health.entity';
import { ScriptEntity } from '../scripts/script.entity';
import { ScriptPackEntity } from '../scripts/script-pack.entity';
import { AssetEntity } from '../scripts/asset.entity';
import { WarmupPlanService } from './warmup-plan.service';
import { WarmupPhaseService } from './warmup-phase.service';
import { WarmupPairService } from './warmup-pair.service';
import { WarmupCalendarService } from './warmup-calendar.service';
import { WarmupExecutor } from '../tasks/executors/warmup.executor';
import { StatusPostExecutor } from './status-post.executor';
import { StatusBrowseExecutor } from './status-browse.executor';
import { WarmupController } from './warmup.controller';
import { AdminDebugController } from './admin-debug.controller';
import { BaileysModule } from '../baileys/baileys.module';

// WarmupModule 集中托管养号日历 + 4 种 warmup-family executor (warmup/script_chat pair 协同/status_post/status_browse).
// 不 import ScriptsModule / SlotsModule, 通过 TypeOrmModule.forFeature 直接拿 repos — 打破 scripts ↔ warmup 潜在循环依赖.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      WarmupPlanEntity,
      TaskEntity,
      AccountSlotEntity,
      WaAccountEntity,
      AccountHealthEntity,
      ScriptEntity,
      ScriptPackEntity,
      AssetEntity,
    ]),
    BaileysModule,
  ],
  controllers: [WarmupController, AdminDebugController],
  providers: [
    WarmupPlanService,
    WarmupPhaseService,
    WarmupPairService,
    WarmupCalendarService,
    WarmupExecutor,
    StatusPostExecutor,
    StatusBrowseExecutor,
  ],
  exports: [
    WarmupPlanService,
    WarmupPhaseService,
    WarmupPairService,
    WarmupCalendarService,
    WarmupExecutor,
    StatusPostExecutor,
    StatusBrowseExecutor,
  ],
})
export class WarmupModule {}
