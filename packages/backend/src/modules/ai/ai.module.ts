import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiProviderEntity } from './ai-provider.entity';
import { AppSettingEntity } from '../../common/app-setting.entity';
import { AiEncryptionService } from './ai-encryption.service';
import { AiProvidersService } from './ai-providers.service';
import { AiTextService } from './ai-text.service';
import { AiSettingsService } from './ai-settings.service';
import { EnvMasterKeyProvider, MASTER_KEY_PROVIDER } from './master-key.provider';
import { MachineBoundMasterKeyProvider } from './machine-bound-master-key.provider';
import { OpenAICompatAdapter } from './adapters/openai-compat.adapter';
import { GeminiAdapter } from './adapters/gemini.adapter';
import { ClaudeAdapter } from './adapters/claude.adapter';
import { AiProvidersController, AiSettingsController } from './ai.controller';

// Global 让 ScriptsModule 的 Runner 可以直接 inject AiTextService / AiSettingsService
// 不用 import AiModule (避开新的交叉依赖). AI 是全局基础服务.
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AiProviderEntity, AppSettingEntity])],
  controllers: [AiProvidersController, AiSettingsController],
  providers: [
    // M10 · MasterKey 策略:
    //   MASTER_KEY_PROVIDER 绑定到 MachineBound · AiEncryptionService 日常加解密走此
    //   EnvMasterKeyProvider 仍可独立 inject (不占 token), 给 MasterKeyMigrationService 走 E1 迁移
    // 全新安装 (data/config/master-key-fingerprint.txt 不存在): MachineBound 首次生成 + 保存
    // 升级老数据: Migration service 用 Env 解 → MachineBound 加 → 数据就位后 Env 不再用
    EnvMasterKeyProvider,
    MachineBoundMasterKeyProvider,
    { provide: MASTER_KEY_PROVIDER, useExisting: MachineBoundMasterKeyProvider },
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
    // M10 · Export 让 BackupModule 的 MasterKeyMigrationService 注入 Env/MachineBound
    EnvMasterKeyProvider,
    MachineBoundMasterKeyProvider,
    MASTER_KEY_PROVIDER, // symbol · 给 BackupExport/Import/HardwareRecovery 走 @Inject 注入
  ],
})
export class AiModule {}
