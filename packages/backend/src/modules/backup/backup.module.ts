// M10 · Backup Module 装配
//
// 依赖:
//   - AiModule (AiEncryptionService + MASTER_KEY_PROVIDER + Env/MachineBound provider classes)
//   - BaileysModule (evictFromPool for per-slot restore / import)
//   - AuthModule (Roles guard)

import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountSlotEntity } from '../slots/account-slot.entity';
import { AppSettingEntity } from '../../common/app-setting.entity';
import { AiProviderEntity } from '../ai/ai-provider.entity';
import { AuthModule } from '../auth/auth.module';
import { BaileysModule } from '../baileys/baileys.module';
import { BackupService } from './backup.service';
import { BackupExportService } from './backup-export.service';
import { BackupImportService } from './backup-import.service';
import { PerSlotRestoreService } from './per-slot-restore.service';
import { MasterKeyMigrationService } from './master-key-migration.service';
import { HardwareRecoveryService } from './hardware-recovery.service';
import { BackupController } from './backup.controller';

// Global · 未来其他 module 可能要触发 ad-hoc backup (比如升级前 pre-update.wab)
@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([AccountSlotEntity, AppSettingEntity, AiProviderEntity]),
    AuthModule,
    BaileysModule,
    // AiModule 是 @Global · 不需 import 也可 inject EnvMasterKey / MachineBoundMasterKey
  ],
  controllers: [BackupController],
  providers: [
    BackupService,
    BackupExportService,
    BackupImportService,
    PerSlotRestoreService,
    MasterKeyMigrationService,
    HardwareRecoveryService,
  ],
  exports: [
    BackupService,
    BackupExportService,
    BackupImportService,
    PerSlotRestoreService,
    HardwareRecoveryService,
  ],
})
export class BackupModule {}
