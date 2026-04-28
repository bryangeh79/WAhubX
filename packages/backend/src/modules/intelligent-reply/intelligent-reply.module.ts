import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';

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
import { TenantEntity } from '../tenants/tenant.entity';

import { PlatformAiService } from './services/platform-ai.service';
import { FileParserService } from './services/file-parser.service';
import { KnowledgeBaseService } from './services/knowledge-base.service';
import { TenantReplySettingsService } from './services/tenant-reply-settings.service';
import { AutoReplyDeciderService } from './services/auto-reply-decider.service';
import { ReplyExecutorService } from './services/reply-executor.service';
import { ReplyDebugService } from './services/reply-debug.service';

import { KnowledgeBaseController } from './controllers/knowledge-base.controller';
import { TenantReplySettingsController } from './controllers/tenant-reply-settings.controller';
import { ConversationsController } from './controllers/conversations.controller';
import { ReplyDebugController } from './controllers/reply-debug.controller';

import { SlotsModule } from '../slots/slots.module';
import { AiModule } from '../ai/ai.module';

// 2026-04-29 · ENABLE_AI_DEBUG_ENDPOINT=true 才挂 dry-run 控制器
//   生产 default false · 防租户乱用 / 防真发 WA
const debugControllers = (() => {
  const flag = process.env.ENABLE_AI_DEBUG_ENDPOINT;
  return flag === 'true' || flag === '1' ? [ReplyDebugController] : [];
})();
const debugProviders = (() => {
  const flag = process.env.ENABLE_AI_DEBUG_ENDPOINT;
  return flag === 'true' || flag === '1' ? [ReplyDebugService] : [];
})();

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
      TenantEntity,
    ]),
    ConfigModule,
    SlotsModule,
    AiModule,
  ],
  controllers: [
    KnowledgeBaseController,
    TenantReplySettingsController,
    ConversationsController,
    ...debugControllers,
  ],
  providers: [
    PlatformAiService,
    FileParserService,
    KnowledgeBaseService,
    TenantReplySettingsService,
    AutoReplyDeciderService,
    ReplyExecutorService,
    ...debugProviders,
  ],
  exports: [
    PlatformAiService,
    KnowledgeBaseService,
    ReplyExecutorService,
    AutoReplyDeciderService,
  ],
})
export class IntelligentReplyModule {}
