import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { KnowledgeBaseEntity } from './entities/knowledge-base.entity';
import { KbSourceEntity } from './entities/kb-source.entity';
import { KbChunkEntity } from './entities/kb-chunk.entity';
import { KbFaqEntity } from './entities/kb-faq.entity';
import { KbProtectedEntity } from './entities/kb-protected.entity';
import { TenantReplySettingsEntity } from './entities/tenant-reply-settings.entity';
import { CustomerConversationEntity } from './entities/customer-conversation.entity';
import { PendingInboundEntity } from './entities/pending-inbound.entity';
import { AiReplyAuditEntity } from './entities/ai-reply-audit.entity';
import { AccountSlotEntity } from '../slots/account-slot.entity';

import { PlatformAiService } from './services/platform-ai.service';
import { FileParserService } from './services/file-parser.service';
import { KnowledgeBaseService } from './services/knowledge-base.service';
import { TenantReplySettingsService } from './services/tenant-reply-settings.service';
import { AutoReplyDeciderService } from './services/auto-reply-decider.service';
import { ReplyExecutorService } from './services/reply-executor.service';

import { KnowledgeBaseController } from './controllers/knowledge-base.controller';
import { TenantReplySettingsController } from './controllers/tenant-reply-settings.controller';
import { ConversationsController } from './controllers/conversations.controller';

import { BaileysModule } from '../baileys/baileys.module';
import { SlotsModule } from '../slots/slots.module';
import { AiModule } from '../ai/ai.module';

// 2026-04-24 · 智能客服 V1 · 完整模块
@Module({
  imports: [
    TypeOrmModule.forFeature([
      KnowledgeBaseEntity,
      KbSourceEntity,
      KbChunkEntity,
      KbFaqEntity,
      KbProtectedEntity,
      TenantReplySettingsEntity,
      CustomerConversationEntity,
      PendingInboundEntity,
      AiReplyAuditEntity,
      AccountSlotEntity,
    ]),
    BaileysModule,
    SlotsModule, // 2026-04-26 · R9-bis · ReplyExecutorService 注 SlotsService.sendText facade
    AiModule,
  ],
  controllers: [
    KnowledgeBaseController,
    TenantReplySettingsController,
    ConversationsController,
  ],
  providers: [
    PlatformAiService,
    FileParserService,
    KnowledgeBaseService,
    TenantReplySettingsService,
    AutoReplyDeciderService,
    ReplyExecutorService,
  ],
  exports: [
    PlatformAiService,
    KnowledgeBaseService,
    ReplyExecutorService,
    AutoReplyDeciderService,
  ],
})
export class IntelligentReplyModule {}
