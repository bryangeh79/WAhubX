import {
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
} from '@nestjs/common';
import { ChannelItemsService } from './channel-items.service';
import { CreateChannelItemDto } from './dto/create-channel-item.dto';
import { BulkImportDto, PickRandomDto } from './dto/bulk-import.dto';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';

@Controller({ path: 'channel-items', version: '1' })
export class AdminChannelItemsController {
  constructor(private readonly service: ChannelItemsService) {}

  @Get()
  async list(
    @CurrentUser() cur: RequestUser,
    @Query('tag') tag?: string,
    @Query('onlyGlobal') onlyGlobal?: string,
  ) {
    return this.service.listForTenant(cur.tenantId, {
      tag,
      onlyGlobal: onlyGlobal === 'true',
    });
  }

  @Get('tags')
  async listTags(@CurrentUser() cur: RequestUser) {
    return this.service.listTags(cur.tenantId);
  }

  @Post('pick-random')
  @HttpCode(HttpStatus.OK)
  async pickRandom(@CurrentUser() cur: RequestUser, @Body() dto: PickRandomDto) {
    return this.service.pickRandom(cur.tenantId, {
      tags: dto.tags,
      count: dto.count,
      onlyGlobal: dto.onlyGlobal,
    });
  }

  @Post()
  async create(
    @CurrentUser() cur: RequestUser,
    @Body() dto: CreateChannelItemDto,
    @Query('global') global?: string,
  ) {
    const asGlobal = global === 'true' && cur.tenantId === null;
    return this.service.create(cur.tenantId, dto, asGlobal);
  }

  @Patch(':id')
  async update(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<CreateChannelItemDto>,
  ) {
    return this.service.update(id, cur.tenantId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    await this.service.remove(id, cur.tenantId);
  }

  @Post('bulk-import')
  async bulkImport(
    @CurrentUser() cur: RequestUser,
    @Body() dto: BulkImportDto,
    @Query('global') global?: string,
  ) {
    const asGlobal = global === 'true' && cur.tenantId === null;
    return this.service.bulkImport(cur.tenantId, dto.csv, dto.defaultTag, asGlobal);
  }
}
