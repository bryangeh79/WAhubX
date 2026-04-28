// 2026-04-28 · Phase D · 持久化 + entity · runtime 中性
// 取代老 BaileysModule 内的 entity / persistMessage 出口

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatMessageEntity } from './chat-message.entity';
import { WaContactEntity } from './wa-contact.entity';
import { MessagingPersistenceService } from './messaging-persistence.service';

@Module({
  imports: [TypeOrmModule.forFeature([ChatMessageEntity, WaContactEntity])],
  providers: [MessagingPersistenceService],
  exports: [MessagingPersistenceService, TypeOrmModule],
})
export class MessagingModule {}
