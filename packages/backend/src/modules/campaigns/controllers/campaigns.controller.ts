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
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../../auth/decorators/current-user.decorator';
import { CampaignsService } from '../services/campaigns.service';
import { CreateCampaignDto, PreviewSafetyDto, UpdateCampaignDto } from '../dto/campaign.dto';
import { CampaignStatus } from '../entities/campaign.entity';
import { MatureSlotPickerService } from '../services/mature-slot-picker.service';
import { CampaignFeatureFlagGuard } from '../guards/feature-flag.guard';

@Controller({ path: 'campaigns', version: '1' })
@UseGuards(CampaignFeatureFlagGuard)
export class CampaignsController {
  constructor(
    private readonly service: CampaignsService,
    private readonly matureSlots: MatureSlotPickerService,
  ) {}

  private tenantOf(cur: RequestUser): number {
    if (cur.tenantId === null) throw new BadRequestException('请切换到租户视角');
    return cur.tenantId;
  }

  @Get()
  list(@CurrentUser() cur: RequestUser, @Query('status') status?: string) {
    const st = status !== undefined ? (Number(status) as CampaignStatus) : undefined;
    return this.service.list(this.tenantOf(cur), st);
  }

  @Get('mature-slots')
  matureSlotsList(@CurrentUser() cur: RequestUser) {
    return this.matureSlots.findMatureSlots(this.tenantOf(cur));
  }

  // 2026-04-24 · 自定义槽位 UI 用 · 返所有可选槽位 (含未成熟 · 带 isMature 标记)
  @Get('slots')
  allSlots(@CurrentUser() cur: RequestUser) {
    return this.matureSlots.findAllActiveSlots(this.tenantOf(cur));
  }

  @Post('preview-safety')
  previewSafety(@CurrentUser() cur: RequestUser, @Body() dto: PreviewSafetyDto) {
    return this.service.previewSafety(this.tenantOf(cur), dto);
  }

  @Get(':id')
  getOne(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.findById(this.tenantOf(cur), id);
  }

  @Get(':id/runs')
  listRuns(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.listRuns(this.tenantOf(cur), id);
  }

  @Get(':id/targets')
  listTargets(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Query('runId') runId?: string,
  ) {
    return this.service.listTargets(this.tenantOf(cur), id, runId ? Number(runId) : undefined);
  }

  @Get(':id/report')
  report(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.report(this.tenantOf(cur), id);
  }

  @Post(':id/clone')
  cloneCampaign(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.clone(this.tenantOf(cur), id);
  }

  @Post()
  create(@CurrentUser() cur: RequestUser, @Body() dto: CreateCampaignDto) {
    return this.service.create(this.tenantOf(cur), cur.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.service.update(this.tenantOf(cur), id, dto);
  }

  @Post(':id/start')
  start(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.start(this.tenantOf(cur), id);
  }

  @Post(':id/pause')
  pause(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.pause(this.tenantOf(cur), id);
  }

  @Post(':id/resume')
  resume(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.resume(this.tenantOf(cur), id);
  }

  // 2026-04-27 · 强推所有 pending task 立即执行 · 不等节流窗口
  @Post(':id/run-now')
  runNow(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.runNow(this.tenantOf(cur), id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    await this.service.cancel(this.tenantOf(cur), id);
  }
}
