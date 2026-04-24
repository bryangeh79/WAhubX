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
  UseGuards,
} from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../../auth/decorators/current-user.decorator';
import { AdvertisementsService } from '../services/advertisements.service';
import {
  CreateAdvertisementDto,
  GenerateVariantsDto,
  UpdateAdvertisementDto,
} from '../dto/advertisement.dto';
import { CampaignFeatureFlagGuard } from '../guards/feature-flag.guard';

@Controller({ path: 'advertisements', version: '1' })
@UseGuards(CampaignFeatureFlagGuard)
export class AdvertisementsController {
  constructor(private readonly service: AdvertisementsService) {}

  private tenantOf(cur: RequestUser): number {
    if (cur.tenantId === null) {
      throw new BadRequestException('平台超管无广告资源; 请切换到租户视角');
    }
    return cur.tenantId;
  }

  @Get()
  list(@CurrentUser() cur: RequestUser) {
    return this.service.list(this.tenantOf(cur));
  }

  @Get(':id')
  getOne(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    return this.service.findById(this.tenantOf(cur), id);
  }

  @Post()
  create(@CurrentUser() cur: RequestUser, @Body() dto: CreateAdvertisementDto) {
    return this.service.create(this.tenantOf(cur), dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAdvertisementDto,
  ) {
    return this.service.update(this.tenantOf(cur), id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    await this.service.remove(this.tenantOf(cur), id);
  }

  // 2026-04-24 · AI 生成变体池 · append=true 追加 / 缺省替换
  @Post(':id/generate-variants')
  generateVariants(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: GenerateVariantsDto,
  ) {
    return this.service.generateVariants(
      this.tenantOf(cur),
      id,
      dto.count ?? 10,
      dto.append ?? false,
    );
  }
}
