import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  InternalServerErrorException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { LicenseService } from './license.service';
import { GenerateLicenseDto } from './dto/generate-license.dto';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole } from '../users/user.entity';

// 2026-04-21 · 双模式:
//   LICENSE_SERVER_URL + LICENSE_ADMIN_KEY 都配了 → 代理模式 · 调 VPS
//   没配 → 本地模式 · 用本地 DB (dev fallback)
@Controller({ path: 'admin/licenses', version: '1' })
@UseGuards(RolesGuard)
@Roles(UserRole.Admin)
export class AdminLicensesController {
  constructor(
    private readonly license: LicenseService,
    private readonly config: ConfigService,
  ) {}

  private getRemoteConfig(): { url: string; adminKey: string } | null {
    const url = this.config.get<string>('LICENSE_SERVER_URL');
    const adminKey = this.config.get<string>('LICENSE_ADMIN_KEY');
    if (!url || !adminKey) return null;
    return { url, adminKey };
  }

  private async proxyFetch(
    path: string,
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    body?: unknown,
  ): Promise<unknown> {
    const remote = this.getRemoteConfig();
    if (!remote) throw new InternalServerErrorException('License Server 未配置');
    const res = await fetch(`${remote.url}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${remote.adminKey}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw new BadRequestException(
        (json as { error?: string; message?: string }).error ??
          (json as { message?: string }).message ??
          `License Server 返 ${res.status}`,
      );
    }
    return json;
  }

  @Get()
  async list(@CurrentUser() cur: RequestUser) {
    if (this.getRemoteConfig()) {
      const resp = (await this.proxyFetch('/admin/licenses', 'GET')) as {
        licenses?: Array<Record<string, unknown>>;
      };
      const rows = resp.licenses ?? [];
      // 统一成前端期待的 shape: { id, licenseKey, tenant: {...}, machineFingerprint, revoked, createdAt }
      // VPS schema 是扁平的 (license_key, tenant_name, plan, slot_limit, active, machine_id, created_at)
      return rows.map((r) => ({
        id: r.id,
        licenseKey: r.license_key ?? r.licenseKey,
        tenant: {
          id: null, // VPS 无 tenant id 概念
          name: r.tenant_name ?? r.tenantName,
          plan: r.plan,
          slotLimit: r.slot_limit ?? r.slotLimit,
        },
        machineFingerprint: r.machine_id ?? r.machineId ?? null,
        issuedAt: null,
        expiresAt: r.expires_at ?? r.expiresAt ?? null,
        lastVerifiedAt: r.last_heartbeat ?? r.lastHeartbeat ?? null,
        revoked: r.active === 0 || r.active === false,
        createdAt: r.created_at ?? r.createdAt,
      }));
    }
    // 本地 fallback
    const scope = cur.tenantId === null ? undefined : cur.tenantId;
    const licenses = await this.license.listAll(scope);
    return licenses.map((l) => ({
      id: l.id,
      licenseKey: l.licenseKey,
      tenant: l.tenant
        ? { id: l.tenant.id, name: l.tenant.name, plan: l.tenant.plan, slotLimit: l.tenant.slotLimit }
        : null,
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
    if (cur.tenantId !== null) {
      throw new ForbiddenException('只有平台超级管理员可以生成 License');
    }
    if (this.getRemoteConfig()) {
      // 2026-04-21 · bcrypt password hash 再送 VPS (VPS 永不看明文)
      const passwordHash = await bcrypt.hash(dto.tenantPassword, 12);
      const resp = (await this.proxyFetch('/admin/licenses', 'POST', {
        tenantName: dto.tenantName,
        tenantEmail: dto.tenantEmail,
        tenantUsername: dto.tenantUsername,
        passwordHash,
        plan: dto.plan,
        expiresAt: dto.expiresAt,
        notes: dto.tenantFullName ? `fullName=${dto.tenantFullName}` : undefined,
      })) as { license?: Record<string, unknown> };
      return resp.license ?? resp;
    }
    // 本地 fallback
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
  async revoke(@CurrentUser() cur: RequestUser, @Param('id') id: string) {
    if (cur.tenantId !== null) {
      throw new ForbiddenException('只有平台超级管理员可以吊销 License');
    }
    if (this.getRemoteConfig()) {
      // VPS: PATCH /admin/licenses/:id { active: false }
      return this.proxyFetch(`/admin/licenses/${id}`, 'PATCH', { active: false });
    }
    // 本地 fallback · 需要数字 id
    const nid = parseInt(id, 10);
    if (Number.isNaN(nid)) throw new BadRequestException('id 必须是数字 (本地模式)');
    const license = await this.license.revoke(nid);
    return { id: license.id, licenseKey: license.licenseKey, revoked: license.revoked };
  }

  // 2026-04-21 新增 · VPS 模式下完全删 license (本地模式暂不支持)
  @Delete(':id')
  async remove(@CurrentUser() cur: RequestUser, @Param('id') id: string) {
    if (cur.tenantId !== null) {
      throw new ForbiddenException('只有平台超级管理员可以删除 License');
    }
    if (!this.getRemoteConfig()) {
      throw new BadRequestException('本地模式不支持删除 license · 使用 revoke');
    }
    return this.proxyFetch(`/admin/licenses/${id}`, 'DELETE');
  }

  // VPS 模式 · 解绑机器 (以便迁移机器)
  @Post(':id/unbind')
  async unbind(@CurrentUser() cur: RequestUser, @Param('id') id: string) {
    if (cur.tenantId !== null) {
      throw new ForbiddenException('只有平台超级管理员可以解绑 License');
    }
    if (!this.getRemoteConfig()) {
      throw new BadRequestException('本地模式不支持解绑 · 请 revoke 旧 license 再建新的');
    }
    return this.proxyFetch(`/admin/licenses/${id}/unbind`, 'POST');
  }

  // VPS 模式 · 看统计
  @Get('dashboard')
  async dashboard(@CurrentUser() cur: RequestUser) {
    if (cur.tenantId !== null) {
      throw new ForbiddenException('只有平台超级管理员可以看 Dashboard');
    }
    if (!this.getRemoteConfig()) {
      throw new BadRequestException('本地模式暂无 Dashboard');
    }
    return this.proxyFetch('/admin/dashboard', 'GET');
  }
}
