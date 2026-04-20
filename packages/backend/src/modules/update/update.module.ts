// M11 Day 3 · UpdateModule · /version/* 路由 + UpdateService
//
// 依赖:
//   - SigningModule (@Global · Ed25519VerifierService 直接 inject)
//   - BackupModule (@Global · BackupExportService · Day 4 才真用)
//   - AuthModule (Roles guard)
//
// 不依赖 M8 health/dispatcher/risk (严守 M11 约束)

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { VersionService } from './version.service';
import { UpdateService } from './update.service';
import { VersionController } from './version.controller';

@Module({
  imports: [AuthModule],
  controllers: [VersionController],
  providers: [VersionService, UpdateService],
  exports: [VersionService, UpdateService],
})
export class UpdateModule {}
