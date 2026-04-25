import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BaileysService } from './baileys.service';
import { StatusCacheService } from './status-cache.service';
import { WaContactEntity } from './wa-contact.entity';
import { ChatMessageEntity } from './chat-message.entity';
// 2026-04-25 · Phase 2 · 子进程隔离 orchestrator
import { BaileysWorkerManagerService } from './worker/baileys-worker-manager.service';

@Module({
  imports: [TypeOrmModule.forFeature([WaContactEntity, ChatMessageEntity])],
  providers: [BaileysService, StatusCacheService, BaileysWorkerManagerService],
  exports: [BaileysService, StatusCacheService, BaileysWorkerManagerService, TypeOrmModule],
})
export class BaileysModule {}
