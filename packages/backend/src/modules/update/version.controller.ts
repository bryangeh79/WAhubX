// M11 Day 3 · Version + Update controllers
//
// 路由:
//   GET  /api/v1/version/current       当前版本 + fp-installer
//   POST /api/v1/version/verify-upd    multipart .wupd · 返 PreviewResult · 不写任何东西
//   POST /api/v1/version/apply-update  multipart .wupd · Day 3 返 501 · Day 4 真实装
//
// 权限: Admin-only (升级是租户级敏感操作)

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/user.entity';
import { VersionService } from './version.service';
import { UpdateService } from './update.service';

const MAX_WUPD_SIZE = 500 * 1024 * 1024; // 500MB · 全量 app.tar + migrations 上限

@Controller('version')
@UseGuards(RolesGuard)
@Roles(UserRole.Admin)
export class VersionController {
  constructor(
    private readonly versionSvc: VersionService,
    private readonly updateSvc: UpdateService,
  ) {}

  @Get('current')
  current() {
    return this.versionSvc.getCurrent();
  }

  @Post('verify-upd')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_WUPD_SIZE } }))
  async verifyUpd(@UploadedFile() file: { buffer: Buffer } | undefined) {
    if (!file) throw new BadRequestException('缺 file 字段 (multipart)');
    return this.updateSvc.preview(file.buffer);
  }

  @Post('apply-update')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_WUPD_SIZE } }))
  async applyUpd(
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Body() _body: unknown,
  ) {
    if (!file) throw new BadRequestException('缺 file 字段 (multipart)');
    // Day 3 返 501 (骨架)
    const result = await this.updateSvc.apply(file.buffer);
    // 非标 HTTP 501 · 返 200 + code · 让 UI 知道是 planned not-implemented 不是 bug
    return result;
  }
}
