import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExecutionGroupEntity } from './execution-group.entity';
import { AccountSlotEntity } from '../slots/account-slot.entity';
import { ExecutionGroupsService } from './execution-groups.service';
import { AdminExecutionGroupsController } from './admin-execution-groups.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ExecutionGroupEntity, AccountSlotEntity])],
  controllers: [AdminExecutionGroupsController],
  providers: [ExecutionGroupsService],
  exports: [ExecutionGroupsService],
})
export class ExecutionGroupsModule {}
