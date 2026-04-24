// M7 Day 6 · AssetsTab backend controller
//
// 路由 (Admin-only):
//   GET  /assets/personas              列 persona 库
//   GET  /assets/list                   列 asset · 支 kind / personaId / poolName filter
//   POST /assets/upload                 multipart · 用户手动上传 · source=manual_upload
//   POST /assets/generate-persona       触发 PersonaGeneratorService · 返 report
//   DELETE /assets/:id                  删 asset + 磁盘文件
//   GET  /assets/quota/:personaId       配额显示 · 100 图 + 50 语音 / persona
//
// 权限: @Roles(Admin) · 租户级敏感操作

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDataDir } from '../../common/storage';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { UserRole } from '../users/user.entity';
import { AssetService } from './asset.service';
import { PersonaGeneratorService } from './persona-generator.service';
import { PersonaEntity } from './persona.entity';
import { AssetEntity, AssetKind, AssetSource } from '../scripts/asset.entity';
import { EthnicityMY, type EthnicityMY as EthnicityMyType } from './persona.types';
import { AssetPoolService } from './asset-pool.service';

const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
const QUOTA_IMAGE_PER_PERSONA = 100;
const QUOTA_VOICE_PER_PERSONA = 50;

@Controller('assets')
@UseGuards(RolesGuard)
@Roles(UserRole.Admin)
export class AssetsController {
  constructor(
    private readonly assetSvc: AssetService,
    private readonly personaGen: PersonaGeneratorService,
    @InjectRepository(PersonaEntity) private readonly personaRepo: Repository<PersonaEntity>,
    @InjectRepository(AssetEntity) private readonly assetRepo: Repository<AssetEntity>,
    private readonly assetPool: AssetPoolService,
  ) {}

  // 2026-04-22 · 素材池管理 · 给 send_* executor 用
  @Get('pools')
  async listPools(@Query('kind') kind?: string) {
    const k = kind && (Object.values(AssetKind) as string[]).includes(kind)
      ? (kind as AssetKind) : undefined;
    return this.assetPool.listPools(k);
  }

  @Post('reindex')
  @HttpCode(200)
  async reindex() {
    return this.assetPool.reindexAll();
  }

  // 2026-04-22 · 按 kind + pool 列 asset · 前端素材库 UI 预览用
  @Get()
  async listByKindPool(
    @Query('kind') kind: string,
    @Query('pool') pool: string,
  ) {
    if (!kind || !pool) throw new BadRequestException('kind + pool 必填');
    if (!(Object.values(AssetKind) as string[]).includes(kind)) {
      throw new BadRequestException(`kind 必须是 ${Object.values(AssetKind).join('/')}`);
    }
    return this.assetPool.listInPool(kind as AssetKind, pool);
  }

  // 2026-04-24 · 单条 asset 元数据 · 给前端预览/列表渲染 · 不带文件
  @Get('meta/:id')
  async getMeta(@Param('id', ParseIntPipe) id: number): Promise<AssetEntity> {
    const asset = await this.assetRepo.findOne({ where: { id } });
    if (!asset) throw new NotFoundException('asset 不存在');
    return asset;
  }

  // 2026-04-22 · 文件 serve · 给前端 <img/audio/video> 预览用
  // @Public: <img src> 浏览器直发 · 不经 axios · 不带 JWT. 本地桌面应用单租户场景安全.
  @Public()
  @Get('file/:id')
  async serveFile(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const asset = await this.assetRepo.findOne({ where: { id } });
    if (!asset) throw new NotFoundException('asset 不存在');
    const abs = path.join(getDataDir(), asset.filePath);
    if (!fs.existsSync(abs)) throw new NotFoundException('文件已删除');
    const mime = this.guessMime(abs);
    if (mime) res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(abs).pipe(res);
  }

  private guessMime(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();
    const map: Record<string, string> = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.mov': 'video/quicktime',
      '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg',
      '.opus': 'audio/opus',
      '.m4a': 'audio/mp4',
    };
    return map[ext] ?? null;
  }

  @Get('personas')
  async listPersonas(): Promise<PersonaEntity[]> {
    return this.personaRepo.find({ order: { createdAt: 'DESC' }, take: 100 });
  }

  @Get('list')
  async listAssets(
    @Query('kind') kind?: string,
    @Query('personaId') personaId?: string,
    @Query('poolName') poolName?: string,
  ): Promise<AssetEntity[]> {
    const where: Record<string, unknown> = {};
    if (kind) where.kind = kind;
    if (personaId) where.personaId = personaId;
    if (poolName) where.poolName = poolName;
    return this.assetRepo.find({
      where,
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  @Post('upload')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadAsset(
    @UploadedFile() file: { buffer: Buffer; originalname: string; mimetype: string } | undefined,
    @Body()
    body: { kind: string; poolName: string; personaId?: string },
  ): Promise<AssetEntity> {
    if (!file) throw new BadRequestException('缺 file 字段 (multipart)');
    if (!body.kind || !body.poolName) {
      throw new BadRequestException('需 kind + poolName');
    }
    const kindEnum = this.parseKind(body.kind);
    const filename = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    return this.assetSvc.create({
      kind: kindEnum,
      poolName: body.poolName,
      filename,
      buffer: file.buffer,
      source: AssetSource.ManualUpload,
      personaId: body.personaId ?? null,
      meta: { originalFilename: file.originalname, mimeType: file.mimetype },
    });
  }

  @Post('generate-persona')
  @HttpCode(200)
  async generatePersona(
    @Body()
    body: { count?: number; ethnicity?: string; style_hint?: string; gender_ratio_female?: number },
  ) {
    const count = Math.min(Math.max(body.count ?? 5, 1), 20);
    const ethnicity = this.parseEthnicity(body.ethnicity ?? EthnicityMY.ChineseMalaysian);
    return this.personaGen.generate({
      count,
      ethnicity,
      style_hint: body.style_hint,
      gender_ratio_female: body.gender_ratio_female,
    });
  }

  @Delete(':id')
  @HttpCode(200)
  async deleteAsset(@Param('id', ParseIntPipe) id: number): Promise<{ ok: boolean }> {
    const ok = await this.assetSvc.delete(id);
    return { ok };
  }

  @Get('quota/:personaId')
  async quota(@Param('personaId') personaId: string) {
    const [images, voices] = await Promise.all([
      this.assetSvc.countByPersonaAndKind(personaId, AssetKind.Image),
      this.assetSvc.countByPersonaAndKind(personaId, AssetKind.Voice),
    ]);
    return {
      personaId,
      images: { used: images, limit: QUOTA_IMAGE_PER_PERSONA },
      voices: { used: voices, limit: QUOTA_VOICE_PER_PERSONA },
    };
  }

  private parseKind(s: string): AssetKind {
    const v = s.toLowerCase();
    if ((Object.values(AssetKind) as string[]).includes(v)) return v as AssetKind;
    throw new BadRequestException(`未知 kind: ${s}`);
  }

  private parseEthnicity(s: string): EthnicityMyType {
    const v = s.toLowerCase();
    if ((Object.values(EthnicityMY) as string[]).includes(v)) return v as EthnicityMyType;
    throw new BadRequestException(`未知 ethnicity: ${s}`);
  }
}
