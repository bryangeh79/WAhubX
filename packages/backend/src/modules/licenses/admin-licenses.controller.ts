import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { LicenseService } from './license.service';
import { GenerateLicenseDto } from './dto/generate-license.dto';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';

// Admin 后台 — 列出 / 生成 / 吊销 license.
// V1 本地部署模型: 所有 admin 都在本机操作同一套 DB.
// V2 拆 VPS License Server 时, 这里会改成调 VPS 的 /admin/licenses API.
@Controller({ path: 'admin/licenses', version: '1' })
@UseGuards(RolesGuard)
@Roles(UserRole.Admin)
export class AdminLicensesController {
  constructor(private readonly license: LicenseService) {}

  @Get()
  async list(@CurrentUser() cur: RequestUser) {
    // 平台超管 tenantId=null 看全部; 租户 admin 只看自己租户的 license
    const scope = cur.tenantId === null ? undefined : cur.tenantId;
    const licenses = await this.license.listAll(scope);
    return licenses.map((l) => ({
      id: l.id,
      licenseKey: l.licenseKey,
      tenant: l.tenant ? { id: l.tenant.id, name: l.tenant.name, plan: l.tenant.plan, slotLimit: l.tenant.slotLimit } : null,
      machineFingerprint: l.machineFingerprint,
      issuedAt: l.issuedAt,
      expiresAt: l.expiresAt,
      lastVerifiedAt: l.lastVerifiedAt,
      revoked: l.revoked,
      createdAt: l.createdAt,
    }));
  }

  @Post()
  async generate(@CurrentUser() cur: RequestUser, @Body() dto: GenerateLicenseDto) {
    // 只有平台超管 (tenantId=null) 可以发新 license
    // (租户 admin 是客户, 不该给自己无限发号)
    if (cur.tenantId !== null) {
      throw new ForbiddenException('只有平台超级管理员可以生成 License');
    }
    const license = await this.license.generate(dto);
    return {
      id: license.id,
      licenseKey: license.licenseKey,
      tenantId: license.tenantId,
      expiresAt: license.expiresAt,
      createdAt: license.createdAt,
    };
  }

  @Post(':id/revoke')
  async revoke(@CurrentUser() cur: RequestUser, @Param('id', ParseIntPipe) id: number) {
    if (cur.tenantId !== null) {
      throw new ForbiddenException('只有平台超级管理员可以吊销 License');
    }
    const license = await this.license.revoke(id);
    return {
      id: license.id,
      licenseKey: license.licenseKey,
      revoked: license.revoked,
    };
  }
}
