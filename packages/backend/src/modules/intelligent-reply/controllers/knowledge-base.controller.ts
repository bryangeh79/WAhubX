import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser, type RequestUser } from '../../auth/decorators/current-user.decorator';
import { KnowledgeBaseService } from '../services/knowledge-base.service';
import type { FaqStatus, FaqSource } from '../entities/kb-faq.entity';
import type { ProtectedEntityType } from '../entities/kb-protected.entity';

const MAX_UPLOAD_SIZE = 20 * 1024 * 1024; // 20 MB

@Controller({ path: 'knowledge-base', version: '1' })
export class KnowledgeBaseController {
  constructor(private readonly service: KnowledgeBaseService) {}

  private tenantOf(cur: RequestUser): number {
    if (cur.tenantId === null) throw new BadRequestException('请切换到租户视角');
    return cur.tenantId;
  }

  // ── KB CRUD ────────────────────────────────

  @Get()
  list(@CurrentUser() cur: RequestUser) {
    return this.service.list(this.tenantOf(cur));
  }

  @Get(':id')
  get(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.get(this.tenantOf(cur), id);
  }

  @Get(':id/stats')
  stats(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.getStats(this.tenantOf(cur), id);
  }

  @Post()
  create(
    @CurrentUser() cur: RequestUser,
    @Body()
    dto: { name: string; description?: string; goalPrompt?: string; isDefault?: boolean },
  ) {
    return this.service.create(this.tenantOf(cur), dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body()
    dto: { name?: string; description?: string; goalPrompt?: string; isDefault?: boolean },
  ) {
    return this.service.update(this.tenantOf(cur), id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    await this.service.remove(this.tenantOf(cur), id);
  }

  // ── 文件上传 ───────────────────────────────

  @Post(':id/sources')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_SIZE } }))
  async uploadFile(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('缺少 file 字段');
    // multer 默认把 originalname 当 latin1 解码 · 中文文件名会乱码 · 手动 fix
    let fileName = file.originalname;
    try {
      fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    } catch {
      // 保底 · 无法转 · 用原值
    }
    return this.service.uploadFile(this.tenantOf(cur), id, {
      buffer: file.buffer,
      fileName,
      mime: file.mimetype,
    });
  }

  @Get(':id/sources')
  listSources(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.listSources(this.tenantOf(cur), id);
  }

  @Delete(':id/sources/:sourceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeSource(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('sourceId', ParseIntPipe) sourceId: number,
  ) {
    await this.service.removeSource(this.tenantOf(cur), id, sourceId);
  }

  // ── FAQ ────────────────────────────────────

  @Get(':id/faqs')
  listFaqs(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Query('status') status?: FaqStatus,
    @Query('source') source?: FaqSource,
  ) {
    return this.service.listFaqs(this.tenantOf(cur), id, { status, source });
  }

  @Post(':id/faqs')
  createFaq(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { question: string; answer: string; tags?: string[] },
  ) {
    return this.service.createFaq(this.tenantOf(cur), id, dto);
  }

  @Post(':id/faqs/bulk')
  bulkImport(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body()
    dto: { items: Array<{ question: string; answer: string; tags?: string[] }> },
  ) {
    if (!Array.isArray(dto.items)) throw new BadRequestException('items 必须是数组');
    return this.service.bulkImportFaqs(this.tenantOf(cur), id, dto.items);
  }

  @Post(':id/faqs/generate')
  async generate(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { count?: number } = {},
  ) {
    return this.service.generateFaqs(this.tenantOf(cur), id, dto);
  }

  @Post(':id/faqs/approve-all-drafts')
  approveAll(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.approveAllDrafts(this.tenantOf(cur), id);
  }

  @Patch(':id/faqs/:faqId')
  updateFaq(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('faqId', ParseIntPipe) faqId: number,
    @Body() dto: { question?: string; answer?: string; tags?: string[]; status?: FaqStatus },
  ) {
    return this.service.updateFaq(this.tenantOf(cur), id, faqId, dto);
  }

  @Delete(':id/faqs/:faqId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeFaq(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('faqId', ParseIntPipe) faqId: number,
  ) {
    await this.service.removeFaq(this.tenantOf(cur), id, faqId);
  }

  // ── 保留实体 ───────────────────────────────

  @Get(':id/protected')
  listProtected(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.listProtected(this.tenantOf(cur), id);
  }

  @Post(':id/protected')
  addProtected(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { entityType: ProtectedEntityType; value: string },
  ) {
    return this.service.addProtected(this.tenantOf(cur), id, dto.entityType, dto.value);
  }

  @Delete(':id/protected/:entityId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeProtected(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('entityId', ParseIntPipe) entityId: number,
  ) {
    await this.service.removeProtected(this.tenantOf(cur), id, entityId);
  }
}
