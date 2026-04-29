import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountSlotEntity } from './account-slot.entity';
import { WaAccountEntity } from './wa-account.entity';
import { SimInfoEntity } from './sim-info.entity';
import { AccountHealthEntity } from './account-health.entity';
import { RecoveryAuditEntity } from './recovery-audit.entity';
import { ProxyEntity } from '../proxies/proxy.entity';
import { SlotsService } from './slots.service';
import { SimInfoService } from './sim-info.service';
import { HandoverService } from './handover.service';
import { SlotHealthService } from './slot-health.service';
import { SlotsController } from './slots.controller';
import { MessagingModule } from '../messaging/messaging.module';
import { SlotRuntimeModule } from '../slot-runtime/slot-runtime.module';
import { RuntimeBridgeModule } from '../runtime-bridge/runtime-bridge.module';
import { RuntimeProcessModule } from '../runtime-process/runtime-process.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AccountSlotEntity,
      WaAccountEntity,
      SimInfoEntity,
      AccountHealthEntity,
      RecoveryAuditEntity,
      ProxyEntity,
    ]),
    MessagingModule,
    SlotRuntimeModule,
    RuntimeBridgeModule,
    RuntimeProcessModule,
    // TakeoverModule is @Global · TakeoverLockService 自动可注入
  ],
  controllers: [SlotsController],
  providers: [SlotsService, SimInfoService, HandoverService, SlotHealthService],
  exports: [SlotsService, SimInfoService, HandoverService, SlotHealthService, TypeOrmModule],
})
export class SlotsModule {}
