// M10 · Backup + Recovery REST API
//
//   GET    /backup/daily                      · snapshot status + daily list
//   POST   /backup/daily/run-now              · 手动触发 daily 快照
//
//   POST   /backup/export                     · body: { notes? } · 生成 manual .wab · 返 metadata
//   POST   /backup/import/preview             · multipart file · 返 manifest + schemaMatches (不写)
//   POST   /backup/import                     · multipart file · 真导入 (自动 pre-import 备份 + 失败回滚)
//
//   GET    /backup/slots/:slotId/snapshots    · 该 slot 可选日期
//   POST   /backup/slots/:slotId/restore      · body: { date? } · 单槽 restore
//
//   GET    /backup/recovery/status            · E2 状态 (normal / locked)
//   POST   /backup/recovery/env-key           · body: { envKeyHex } · E2 recovery A
//   POST   /backup/recovery/import            · multipart file + field overrideKeyHex? · E2 recovery B
//
// 权限: Admin 只 (备份/还原是租户级敏感操作)

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import type { Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/user.entity';
import { BackupService } from './backup.service';
import { BackupExportService } from './backup-export.service';
import { BackupImportService } from './backup-import.service';
import { PerSlotRestoreService } from './per-slot-restore.service';
import { HardwareRecoveryService } from './hardware-recovery.service';
import { getManualDir } from './backup-paths';

const MAX_WAB_SIZE = 2 * 1024 * 1024 * 1024; // 2GB 上限 (全 50 slot + DB dump 估上限)

@Controller('backup')
@UseGuards(RolesGuard)
@Roles(UserRole.Admin)
export class BackupController {
  constructor(
    private readonly backup: BackupService,
    private readonly exportSvc: BackupExportService,
    private readonly importSvc: BackupImportService,
    private readonly perSlot: PerSlotRestoreService,
    private readonly recovery: HardwareRecoveryService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  // ── Daily ────────────────────────────────────────────────
  @Get('daily')
  async dailyStatus() {
    return this.backup.getSnapshotStatus();
  }

  @Post('daily/run-now')
  @HttpCode(200)
  async runDailyNow() {
    return this.backup.runDailyNow();
  }

  // ── Manual Export ────────────────────────────────────────
  @Post('export')
  @HttpCode(200)
  async exportWab(
    @Body() body: { notes?: string },
    @CurrentUser() user: RequestUser,
  ) {
    const result = await this.exportSvc.export({
      source: 'manual-export',
      notes: body.notes,
      tenantId: user.tenantId,
    });
    return {
      filePath: result.filePath,
      filename: path.basename(result.filePath),
      sizeBytes: result.sizeBytes,
      manifest: result.manifest,
    };
  }

  @Get('manual')
  async listManual() {
    const dir = getManualDir();
    const files = fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((f) => f.endsWith('.wab'))
          .map((f) => {
            const abs = path.join(dir, f);
            const stat = fs.statSync(abs);
            return { filename: f, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() };
          })
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      : [];
    return { files };
  }

  @Get('manual/:filename/download')
  async downloadManual(
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    if (!/^[A-Za-z0-9._-]+\.wab$/.test(filename)) {
      throw new BadRequestException('非法文件名');
    }
    const abs = path.join(getManualDir(), filename);
    if (!fs.existsSync(abs)) throw new BadRequestException('文件不存在');
    res.download(abs);
  }

  // ── Import ───────────────────────────────────────────────
  @Post('import/preview')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_WAB_SIZE } }))
  async importPreview(@UploadedFile() file: { buffer: Buffer } | undefined) {
    if (!file) throw new BadRequestException('缺 file 字段');
    return this.importSvc.preview(file.buffer);
  }

  @Post('import')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_WAB_SIZE } }))
  async importWab(@UploadedFile() file: { buffer: Buffer } | undefined) {
    if (!file) throw new BadRequestException('缺 file 字段');
    return this.importSvc.import(file.buffer);
  }

  // ── Per-slot Restore ─────────────────────────────────────
  @Get('slots/:slotId/snapshots')
  async listSlotSnapshots(@Param('slotId', ParseIntPipe) slotId: number) {
    const rows: Array<{ slot_index: number }> = await this.dataSource.query(
      'SELECT slot_index FROM account_slot WHERE id = $1 LIMIT 1',
      [slotId],
    );
    const slotIndex = rows?.[0]?.slot_index;
    if (!slotIndex) return { snapshots: [] };
    const snaps = this.perSlot.listAvailableSnapshots(slotIndex);
    return { slotId, slotIndex, snapshots: snaps };
  }

  @Post('slots/:slotId/restore')
  @HttpCode(200)
  async restoreSlot(
    @Param('slotId', ParseIntPipe) slotId: number,
    @Body() body: { date?: string },
  ) {
    return this.perSlot.restore(slotId, body.date);
  }

  // ── E2 Recovery ──────────────────────────────────────────
  @Get('recovery/status')
  async recoveryStatus() {
    // 每次 GET 重跑 detect · E1 迁移完成后状态可能已变 · UI 轮询触发刷新
    return this.recovery.detect();
  }

  @Post('recovery/env-key')
  @HttpCode(200)
  async recoverEnvKey(@Body() body: { envKeyHex: string }) {
    if (!body?.envKeyHex) throw new BadRequestException('缺 envKeyHex');
    return this.recovery.recoverWithEnvKey(body.envKeyHex);
  }

  @Post('recovery/import')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_WAB_SIZE } }))
  async recoverImport(
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Body() body: { overrideKeyHex?: string },
  ) {
    if (!file) throw new BadRequestException('缺 file 字段');
    return this.recovery.recoverFromWab(file.buffer, body?.overrideKeyHex);
  }
}
