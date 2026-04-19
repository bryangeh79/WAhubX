import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiProviderEntity } from './ai-provider.entity';
import { AiSettingEntity } from './ai-setting.entity';
import { AiEncryptionService } from './ai-encryption.service';
import { AiProvidersService } from './ai-providers.service';
import { AiTextService } from './ai-text.service';
import { AiSettingsService } from './ai-settings.service';
import { EnvMasterKeyProvider, MASTER_KEY_PROVIDER } from './master-key.provider';
import { OpenAICompatAdapter } from './adapters/openai-compat.adapter';
import { GeminiAdapter } from './adapters/gemini.adapter';
import { ClaudeAdapter } from './adapters/claude.adapter';
import { AiProvidersController, AiSettingsController } from './ai.controller';

// Global 让 ScriptsModule 的 Runner 可以直接 inject AiTextService / AiSettingsService
// 不用 import AiModule (避开新的交叉依赖). AI 是全局基础服务.
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AiProviderEntity, AiSettingEntity])],
  controllers: [AiProvidersController, AiSettingsController],
  providers: [
    { provide: MASTER_KEY_PROVIDER, useClass: EnvMasterKeyProvider },
    AiEncryptionService,
    AiProvidersService,
    AiTextService,
    AiSettingsService,
    OpenAICompatAdapter,
    GeminiAdapter,
    ClaudeAdapter,
  ],
  exports: [
    AiEncryptionService,
    AiTextService,
    AiSettingsService,
    AiProvidersService,
  ],
})
export class AiModule {}
