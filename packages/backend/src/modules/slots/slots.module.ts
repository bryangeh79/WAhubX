import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountSlotEntity } from './account-slot.entity';
import { WaAccountEntity } from './wa-account.entity';
import { SimInfoEntity } from './sim-info.entity';
import { AccountHealthEntity } from './account-health.entity';
import { SlotsService } from './slots.service';
import { SlotsController } from './slots.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AccountSlotEntity,
      WaAccountEntity,
      SimInfoEntity,
      AccountHealthEntity,
    ]),
  ],
  controllers: [SlotsController],
  providers: [SlotsService],
  exports: [SlotsService, TypeOrmModule],
})
export class SlotsModule {}
