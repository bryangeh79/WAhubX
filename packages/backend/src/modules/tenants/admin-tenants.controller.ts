import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TenantEntity } from './tenant.entity';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';
import { SlotsService } from '../slots/slots.service';

// Admin 后台租户视图.
// 平台超管 (tenantId=null) 看全部租户; 租户 admin 只能看自己租户.
@Controller({ path: 'admin/tenants', version: '1' })
@UseGuards(RolesGuard)
@Roles(UserRole.Admin)
export class AdminTenantsController {
  constructor(
    @InjectRepository(TenantEntity)
    private readonly tenantRepo: Repository<TenantEntity>,
    private readonly slots: SlotsService,
  ) {}

  @Get()
  async list(@CurrentUser() cur: RequestUser) {
    // 租户 admin 只能看到自己那一条, 避免信息泄露
    if (cur.tenantId !== null) {
      const mine = await this.tenantRepo.findOne({ where: { id: cur.tenantId } });
      return mine ? [this.toResponse(mine)] : [];
    }
    const rows = await this.tenantRepo.find({ order: { createdAt: 'DESC' } });
    return rows.map((t) => this.toResponse(t));
  }

  @Get(':id')
  async findOne(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    if (cur.tenantId !== null && cur.tenantId !== id) {
      throw new ForbiddenException('无权限访问该租户');
    }
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException(`租户 ${id} 不存在`);
    return this.toResponse(tenant);
  }

  // 平台超管查看指定租户的槽位 (规划 — 前端 /admin 页跳转用)
  @Get(':id/slots')
  async listSlots(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    if (cur.tenantId !== null && cur.tenantId !== id) {
      throw new ForbiddenException('无权限访问该租户槽位');
    }
    const tenant = await this.tenantRepo.findOne({ where: { id } });
    if (!tenant) throw new NotFoundException(`租户 ${id} 不存在`);
    return this.slots.listForTenant(id);
  }

  private toResponse(t: TenantEntity) {
    return {
      id: t.id,
      name: t.name,
      email: t.email,
      plan: t.plan,
      slotLimit: t.slotLimit,
      status: t.status,
      country: t.country,
      timezone: t.timezone,
      language: t.language,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }
}
