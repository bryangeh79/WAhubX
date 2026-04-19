import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BaileysService } from './baileys.service';
import { WaContactEntity } from './wa-contact.entity';
import { ChatMessageEntity } from './chat-message.entity';

@Module({
  imports: [TypeOrmModule.forFeature([WaContactEntity, ChatMessageEntity])],
  providers: [BaileysService],
  exports: [BaileysService, TypeOrmModule],
})
export class BaileysModule {}
