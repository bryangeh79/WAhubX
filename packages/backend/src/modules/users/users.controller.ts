import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import type { UserResponseDto } from './dto/user-response.dto';
import { UserRole } from './user.entity';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

// V1 UI 不消费这些端点 (决策: "V1 UI 不做用户管理页"),
// 但数据模型 + API 留好. 登录后用户自己改 profile/preferences/language 必须可用.
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // ── 自己 ────────────────────────────────────────────
  @Get('me')
  async me(@CurrentUser() cur: RequestUser): Promise<UserResponseDto> {
    return this.users.toResponse(await this.users.findOne(cur.id));
  }

  @Put('me')
  async updateMe(
    @CurrentUser() cur: RequestUser,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    // 自己不能改自己的 role / status
    if (dto.role !== undefined || dto.status !== undefined) {
      throw new ForbiddenException('无法修改自己的角色或状态');
    }
    return this.users.toResponse(await this.users.update(cur.id, dto));
  }

  @Put('me/preferences')
  async updateMyPreferences(
    @CurrentUser() cur: RequestUser,
    @Body() dto: UpdatePreferencesDto,
  ): Promise<UserResponseDto> {
    return this.users.toResponse(await this.users.updatePreferences(cur.id, dto));
  }

  @Patch('me/language')
  @HttpCode(HttpStatus.OK)
  async updateMyLanguage(
    @CurrentUser() cur: RequestUser,
    @Body() body: { language?: string },
  ): Promise<{ language: string }> {
    // V1 只做中文, 架构预埋其他语言 (见 tenant.entity 注释)
    const allowed = ['zh', 'en', 'ms'];
    if (!body?.language || !allowed.includes(body.language)) {
      throw new BadRequestException(`language 必须是 ${allowed.join(' / ')} 之一`);
    }
    await this.users.updateLanguage(cur.id, body.language);
    return { language: body.language };
  }

  // ── 读单个 (admin 或本人) ────────────────────────────
  @Get(':id')
  async findOne(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserResponseDto> {
    const user = await this.users.findOne(id);
    this.users.assertCanAccess(cur, user);
    return this.users.toResponse(user);
  }

  // ── admin 列表 ──────────────────────────────────────
  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin)
  async findAll(@CurrentUser() cur: RequestUser, @Query() query: ListUsersQueryDto) {
    // 平台超管 (tenantId=null) 不自动限制; 租户 admin 只能看自己租户
    const scope = cur.tenantId === null ? undefined : cur.tenantId;
    return this.users.findAll(query, scope);
  }

  // ── admin 更新 ──────────────────────────────────────
  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin)
  async adminUpdate(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    const target = await this.users.findOne(id);
    this.users.assertCanAccess(cur, target);
    return this.users.toResponse(await this.users.update(id, dto));
  }

  // ── admin 软删 ──────────────────────────────────────
  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.Admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  async adminRemove(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    if (id === cur.id) throw new BadRequestException('不能删除自己的账号');
    const target = await this.users.findOne(id);
    this.users.assertCanAccess(cur, target);
    await this.users.softDelete(id);
  }
}
