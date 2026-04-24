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
} from '@nestjs/common';
// APP_GUARD 已全局挂 JwtAuthGuard, 这里不需要再 UseGuards
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { ExecutionGroupsService } from './execution-groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';

@Controller({ path: 'execution-groups', version: '1' })
export class AdminExecutionGroupsController {
  constructor(private readonly service: ExecutionGroupsService) {}

  private requireTenant(cur: RequestUser): number {
    if (cur.tenantId === null) {
      throw new BadRequestException('平台超管无自己的执行组; 请切换到租户视角操作');
    }
    return cur.tenantId;
  }

  @Get()
  async list(@CurrentUser() cur: RequestUser) {
    const tenantId = this.requireTenant(cur);
    return this.service.listForTenant(tenantId);
  }

  @Get(':id')
  async getOne(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    const tenantId = this.requireTenant(cur);
    return this.service.getOne(id, tenantId);
  }

  @Post()
  async create(@CurrentUser() cur: RequestUser, @Body() dto: CreateGroupDto) {
    const tenantId = this.requireTenant(cur);
    return this.service.create(tenantId, dto);
  }

  @Patch(':id')
  async update(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGroupDto,
  ) {
    const tenantId = this.requireTenant(cur);
    return this.service.update(id, tenantId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    const tenantId = this.requireTenant(cur);
    await this.service.remove(id, tenantId);
  }
}
