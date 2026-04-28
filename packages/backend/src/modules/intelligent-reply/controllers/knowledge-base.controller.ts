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

  // 2026-04-28 · 通用 FAQ starter (问候/身份/转人工等 52 条) · 灌入指定 KB
  // idempotent · 已存在 question 跳过. id=0 时自动找/建 default KB.
  @Post(':id/faqs/seed-common')
  seedCommon(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    const kbId = id === 0 ? undefined : id;
    return this.service.seedCommonFaqs(this.tenantOf(cur), kbId);
  }

  // 2026-04-28 · 用租户的 AI 把 starter FAQ 改写得贴合公司业务
  // 前提: tenant 必须配 AI provider · 否则返 NO_PROVIDER 错
  // 2026-04-29 · V2.4 · 加 ?force=true query param
  //   不传 (默认): 仅处理还没 customized 过的 starter FAQ (旧行为, 向后兼容)
  //   force=true: 也重新处理已 customized 过的 (用于"重新优化", 覆盖旧答案)
  //   接受值: 'true' / '1' / 'yes' (大小写不敏感) · 其他都按 false
  @Post(':id/faqs/customize-starter')
  customizeStarter(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Query('force') force?: string,
  ) {
    const isForce = typeof force === 'string'
      && ['true', '1', 'yes'].includes(force.toLowerCase().trim());
    return this.service.customizeStarterFaqs(this.tenantOf(cur), id, { force: isForce });
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
