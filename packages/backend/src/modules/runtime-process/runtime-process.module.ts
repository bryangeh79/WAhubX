// 2026-04-25 · D12-2 · RuntimeProcessModule
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountSlotEntity } from '../slots/account-slot.entity';
import { ProxyEntity } from '../proxies/proxy.entity';
import { RuntimeProcessManagerService } from './runtime-process-manager.service';
import { RuntimeProcessController } from './runtime-process.controller';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([AccountSlotEntity, ProxyEntity])],
  controllers: [RuntimeProcessController],
  providers: [RuntimeProcessManagerService],
  exports: [RuntimeProcessManagerService],
})
export class RuntimeProcessModule {}
