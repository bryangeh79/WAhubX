import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { LicenseEntity } from './license.entity';
import { PLAN_SLOT_LIMIT, TenantEntity, TenantStatus } from '../tenants/tenant.entity';
import { User, UserRole, UserStatus } from '../users/user.entity';
import { getMachineId } from './machine-id.util';
import type { GenerateLicenseDto } from './dto/generate-license.dto';
import type { ActivateLicenseDto } from './dto/activate-license.dto';
import type { VerifyLicenseDto } from './dto/verify-license.dto';
import * as bcrypt from 'bcryptjs';

export interface LicenseStatusView {
  activated: boolean;
  valid: boolean;
  licenseKey: string | null;
  plan: string | null;
  slotLimit: number | null;
  tenantName: string | null;
  expiresAt: Date | null;
  machineId: string;
  revoked: boolean;
  error?: string;
}

export interface ActivationResult {
  licenseKey: string;
  tenant: { id: number; name: string; plan: string; slotLimit: number };
  user: { id: string; email: string; username: string; role: UserRole };
}

// 生成格式: WA-XXXX-XXXX-XXXX-XXXX (4x 4 字符 base32 alike, 20 随机字符)
function generateLicenseKey(): string {
  const bytes = randomBytes(10);
  const alphabet = 'ABCDEFGHIJKLMNPQRSTUVWXYZ23456789'; // 去掉易混 O/0/I/1
  let s = '';
  for (let i = 0; i < 16; i++) {
    s += alphabet[bytes[i % bytes.length] % alphabet.length];
  }
  return `WA-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}`;
}

@Injectable()
export class LicenseService {
  private readonly logger = new Logger(LicenseService.name);
  private readonly machineId: string;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(LicenseEntity) private readonly licenseRepo: Repository<LicenseEntity>,
  ) {
    this.machineId = getMachineId();
    this.logger.log(`Machine fingerprint: ${this.machineId.substring(0, 8)}...${this.machineId.slice(-4)}`);
  }

  getMachineId(): string {
    return this.machineId;
  }

  // ── Admin: 创建 license (+tenant, plan→slot_limit 硬映射) ────────────
  async generate(dto: GenerateLicenseDto): Promise<LicenseEntity> {
    return this.dataSource.transaction(async (manager) => {
      const tenant = manager.create(TenantEntity, {
        name: dto.tenantName,
        email: dto.tenantEmail ?? null,
        plan: dto.plan,
        slotLimit: PLAN_SLOT_LIMIT[dto.plan],
        status: TenantStatus.Active,
      });
      const savedTenant = await manager.save(tenant);

      let licenseKey: string;
      let attempts = 0;
      // 生成空间 32^16 ≈ 10^24, 重复概率可忽略但还是做防御
      do {
        licenseKey = generateLicenseKey();
        attempts++;
      } while (
        attempts < 5 &&
        (await manager.findOne(LicenseEntity, { where: { licenseKey } }))
      );

      const license = manager.create(LicenseEntity, {
        licenseKey,
        tenantId: savedTenant.id,
        tenant: savedTenant,
        machineFingerprint: null,
        issuedAt: null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        lastVerifiedAt: null,
        revoked: false,
      });
      const saved = await manager.save(license);
      this.logger.log(`Generated license ${licenseKey} for tenant ${savedTenant.id} (${dto.plan})`);
      return saved;
    });
  }

  // ── Customer: 激活 = 创建 admin user + 绑定 machine ───────────────────
  async activate(dto: ActivateLicenseDto): Promise<ActivationResult> {
    return this.dataSource.transaction(async (manager) => {
      const license = await manager.findOne(LicenseEntity, {
        where: { licenseKey: dto.licenseKey },
        relations: ['tenant'],
      });
      if (!license) throw new NotFoundException('License Key 不存在');
      if (license.revoked) throw new BadRequestException('该 License 已被吊销');
      if (license.expiresAt && license.expiresAt < new Date()) {
        throw new BadRequestException('该 License 已过期');
      }
      if (license.machineFingerprint) {
        throw new ConflictException(
          license.machineFingerprint === this.machineId
            ? '该 License 已在本机激活过'
            : '该 License 已绑定其他机器',
        );
      }
      if (!license.tenant) {
        throw new BadRequestException('License 未关联租户, 请联系管理员');
      }

      const emailLc = dto.adminEmail.toLowerCase().trim();
      const usernameLc = dto.adminUsername.toLowerCase().trim();

      const emailHit = await manager.findOne(User, { where: { email: emailLc } });
      if (emailHit) throw new ConflictException('该邮箱地址已被注册');
      const usernameHit = await manager.findOne(User, { where: { username: usernameLc } });
      if (usernameHit) throw new ConflictException('该用户名已被使用');

      const passwordHash = await bcrypt.hash(dto.adminPassword, 12);
      const adminUser = manager.create(User, {
        tenantId: license.tenantId,
        email: emailLc,
        username: usernameLc,
        passwordHash,
        role: UserRole.Admin,
        status: UserStatus.Active,
        fullName: dto.adminFullName ?? null,
        language: 'zh',
        timezone: 'Asia/Kuala_Lumpur',
        preferences: {},
      });
      const savedUser = await manager.save(adminUser);

      license.machineFingerprint = this.machineId;
      license.issuedAt = new Date();
      license.lastVerifiedAt = new Date();
      await manager.save(license);

      this.logger.log(
        `Activated license ${dto.licenseKey} on machine ${this.machineId.substring(0, 8)}... (tenant ${license.tenantId}, admin ${emailLc})`,
      );

      return {
        licenseKey: license.licenseKey,
        tenant: {
          id: license.tenant.id,
          name: license.tenant.name,
          plan: license.tenant.plan,
          slotLimit: license.tenant.slotLimit,
        },
        user: {
          id: savedUser.id,
          email: savedUser.email,
          username: savedUser.username,
          role: savedUser.role,
        },
      };
    });
  }

  // ── 本机当前绑定状态 (前端启动时调用) ─────────────────────────────
  async getLocalStatus(): Promise<LicenseStatusView> {
    const license = await this.licenseRepo.findOne({
      where: { machineFingerprint: this.machineId },
      relations: ['tenant'],
    });

    if (!license) {
      return {
        activated: false,
        valid: false,
        licenseKey: null,
        plan: null,
        slotLimit: null,
        tenantName: null,
        expiresAt: null,
        machineId: this.machineId,
        revoked: false,
        error: 'Not activated',
      };
    }

    const expired = !!license.expiresAt && license.expiresAt < new Date();
    const valid = !license.revoked && !expired;

    return {
      activated: true,
      valid,
      licenseKey: license.licenseKey,
      plan: license.tenant?.plan ?? null,
      slotLimit: license.tenant?.slotLimit ?? null,
      tenantName: license.tenant?.name ?? null,
      expiresAt: license.expiresAt,
      machineId: this.machineId,
      revoked: license.revoked,
      error: license.revoked ? '该 License 已被吊销' : expired ? 'License 已过期' : undefined,
    };
  }

  // ── 定期 verify (本机 → VPS 或本机 → 本机 DB, V1 用后者) ───────────
  async verify(dto: VerifyLicenseDto): Promise<{ valid: boolean; reason?: string }> {
    const fingerprint = dto.machineFingerprint ?? this.machineId;
    const license = await this.licenseRepo.findOne({
      where: { licenseKey: dto.licenseKey },
    });

    if (!license) return { valid: false, reason: 'License 不存在' };
    if (license.revoked) return { valid: false, reason: 'License 已吊销' };
    if (license.expiresAt && license.expiresAt < new Date()) {
      return { valid: false, reason: 'License 已过期' };
    }
    if (!license.machineFingerprint) {
      return { valid: false, reason: 'License 未激活' };
    }
    if (license.machineFingerprint !== fingerprint) {
      return { valid: false, reason: '指纹不匹配 (License 已绑定其他机器)' };
    }

    license.lastVerifiedAt = new Date();
    await this.licenseRepo.save(license);
    return { valid: true };
  }

  // ── Admin: list / revoke ─────────────────────────────────────────────
  async listAll(scopeToTenantId: number | null | undefined) {
    const qb = this.licenseRepo
      .createQueryBuilder('l')
      .leftJoinAndSelect('l.tenant', 't')
      .orderBy('l.created_at', 'DESC');

    if (scopeToTenantId !== undefined && scopeToTenantId !== null) {
      qb.where('l.tenant_id = :tid', { tid: scopeToTenantId });
    }
    return qb.getMany();
  }

  async revoke(id: number): Promise<LicenseEntity> {
    const license = await this.licenseRepo.findOne({ where: { id } });
    if (!license) throw new NotFoundException(`License ${id} 不存在`);
    if (license.revoked) return license;
    license.revoked = true;
    return this.licenseRepo.save(license);
  }

  async findPendingActivation(licenseKey: string): Promise<LicenseEntity | null> {
    return this.licenseRepo.findOne({
      where: { licenseKey, machineFingerprint: IsNull(), revoked: false },
      relations: ['tenant'],
    });
  }
}
