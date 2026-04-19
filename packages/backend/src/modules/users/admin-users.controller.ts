import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import type { UserResponseDto } from './dto/user-response.dto';
import { UserRole } from './user.entity';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

// Admin 后台入口. FAhubX 版本有 LICENSE_SERVER 远程同步 — 那是 task 2.3 (license 模块) 才接.
// 本文件只管本地 users 表 + 租户隔离.
@Controller({ path: 'admin/users', version: '1' })
@UseGuards(RolesGuard)
@Roles(UserRole.Admin)
export class AdminUsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  async create(
    @CurrentUser() cur: RequestUser,
    @Body() dto: CreateUserDto,
  ): Promise<UserResponseDto> {
    // 租户 admin 只能在自己的租户里开号
    if (cur.tenantId !== null && dto.tenantId !== undefined && dto.tenantId !== cur.tenantId) {
      throw new BadRequestException('租户管理员只能在自己的租户内开号');
    }
    // 默认挂到当前 admin 的租户; 平台超管可显式指定 tenantId (含 null)
    const tenantId = dto.tenantId !== undefined ? dto.tenantId : cur.tenantId;
    const user = await this.users.createForTenant({ ...dto, tenantId });
    return this.users.toResponse(user);
  }

  @Get('stats/overview')
  async stats(@CurrentUser() cur: RequestUser) {
    const scope = cur.tenantId === null ? undefined : cur.tenantId;
    return this.users.getStatsOverview(scope);
  }
}
