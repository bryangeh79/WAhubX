import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BaileysService } from './baileys.service';
import { StatusCacheService } from './status-cache.service';
import { WaContactEntity } from './wa-contact.entity';
import { ChatMessageEntity } from './chat-message.entity';

@Module({
  imports: [TypeOrmModule.forFeature([WaContactEntity, ChatMessageEntity])],
  providers: [BaileysService, StatusCacheService],
  exports: [BaileysService, StatusCacheService, TypeOrmModule],
})
export class BaileysModule {}
