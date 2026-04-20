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
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/user.entity';
import { AssetService } from './asset.service';
import { PersonaGeneratorService } from './persona-generator.service';
import { PersonaEntity } from './persona.entity';
import { AssetEntity, AssetKind, AssetSource } from '../scripts/asset.entity';
import { EthnicityMY, type EthnicityMY as EthnicityMyType } from './persona.types';

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
  ) {}

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
