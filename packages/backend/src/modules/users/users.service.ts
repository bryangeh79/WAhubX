import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User, UserRole, UserStatus } from './user.entity';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import type { UpdatePreferencesDto } from './dto/update-preferences.dto';
import type { ListUsersQueryDto } from './dto/list-users-query.dto';
import type { UserResponseDto } from './dto/user-response.dto';

// 2.1 的最小版本 + 2.2 扩展出完整 CRUD / preferences / 租户隔离
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly config: ConfigService,
  ) {}

  private bcryptRounds(): number {
    return this.config.get<number>('BCRYPT_ROUNDS', 12);
  }

  // ── 基础读 ─────────────────────────────────────────
  async count(): Promise<number> {
    return this.userRepo.count();
  }

  async findOne(id: string): Promise<User> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`用户 ${id} 不存在`);
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { email: email.toLowerCase().trim() } });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.userRepo.findOne({ where: { username: username.toLowerCase().trim() } });
  }

  // ── 列表查询 (租户隔离由调用方传 scopeToTenantId) ───────
  async findAll(
    query: ListUsersQueryDto,
    scopeToTenantId: number | null | undefined,
  ): Promise<{
    items: UserResponseDto[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    const qb = this.userRepo.createQueryBuilder('u').where('u.deleted_at IS NULL');

    // 平台超管 (scopeToTenantId=undefined) 看全部; 租户 admin 只看自己租户
    if (scopeToTenantId !== undefined && scopeToTenantId !== null) {
      qb.andWhere('u.tenant_id = :tid', { tid: scopeToTenantId });
    } else if (scopeToTenantId === null) {
      qb.andWhere('u.tenant_id IS NULL');
    }

    if (query.status) qb.andWhere('u.status = :status', { status: query.status });
    if (query.role) qb.andWhere('u.role = :role', { role: query.role });
    if (query.tenantId) qb.andWhere('u.tenant_id = :qt', { qt: query.tenantId });
    if (query.search) {
      qb.andWhere(
        '(u.email ILIKE :s OR u.username ILIKE :s OR u.full_name ILIKE :s)',
        { s: `%${query.search}%` },
      );
    }

    const total = await qb.getCount();
    const users = await qb
      .orderBy('u.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return {
      items: users.map((u) => this.toResponse(u)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 },
    };
  }

  // ── 创建 (license 激活 / admin 后台调用) ─────────────
  async createForTenant(dto: CreateUserDto): Promise<User> {
    const existingEmail = await this.findByEmail(dto.email);
    if (existingEmail) throw new ConflictException('该邮箱地址已被注册');
    const existingUsername = await this.findByUsername(dto.username);
    if (existingUsername) throw new ConflictException('该用户名已被使用');

    if (!dto.password || dto.password.length < 8) {
      throw new BadRequestException('密码长度至少 8 位');
    }

    const passwordHash = await bcrypt.hash(dto.password, this.bcryptRounds());
    const user = this.userRepo.create({
      tenantId: dto.tenantId ?? null,
      email: dto.email,
      username: dto.username,
      passwordHash,
      role: dto.role,
      status: UserStatus.Active,
      fullName: dto.fullName ?? null,
      language: dto.language ?? 'zh',
      timezone: dto.timezone ?? 'Asia/Kuala_Lumpur',
      preferences: {},
    });
    return this.userRepo.save(user);
  }

  // ── 更新 ────────────────────────────────────────────
  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(id);

    if (dto.email && dto.email.toLowerCase() !== user.email) {
      const exist = await this.findByEmail(dto.email);
      if (exist && exist.id !== id) throw new ConflictException('该邮箱地址已被其他用户使用');
      user.email = dto.email;
    }
    if (dto.username && dto.username.toLowerCase() !== user.username) {
      const exist = await this.findByUsername(dto.username);
      if (exist && exist.id !== id) throw new ConflictException('该用户名已被其他用户使用');
      user.username = dto.username;
    }

    if (dto.fullName !== undefined) user.fullName = dto.fullName;
    if (dto.avatarUrl !== undefined) user.avatarUrl = dto.avatarUrl;
    if (dto.timezone !== undefined) user.timezone = dto.timezone;
    if (dto.language !== undefined) user.language = dto.language;
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.status !== undefined) user.status = dto.status;

    return this.userRepo.save(user);
  }

  async updateLanguage(id: string, language: string): Promise<void> {
    if (!language) throw new BadRequestException('language 不能为空');
    await this.userRepo.update(id, { language });
  }

  async updatePreferences(id: string, dto: UpdatePreferencesDto): Promise<User> {
    const user = await this.findOne(id);
    user.preferences = { ...user.preferences, ...(dto.preferences ?? {}) };
    return this.userRepo.save(user);
  }

  async softDelete(id: string): Promise<void> {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`用户 ${id} 不存在`);
    await this.userRepo.softDelete(id);
  }

  // ── 密码相关 (auth 调用) ────────────────────────────
  async validatePassword(user: Pick<User, 'passwordHash'>, password: string): Promise<boolean> {
    if (!user.passwordHash) return false;
    return bcrypt.compare(password, user.passwordHash);
  }

  async updatePassword(id: string, newPassword: string): Promise<void> {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('密码长度至少 8 位');
    }
    const hash = await bcrypt.hash(newPassword, this.bcryptRounds());
    const res = await this.userRepo.update(id, { passwordHash: hash });
    if (!res.affected) throw new NotFoundException(`用户 ${id} 不存在`);
  }

  async updateLoginStats(id: string): Promise<void> {
    await this.userRepo
      .createQueryBuilder()
      .update(User)
      .set({
        totalLogins: () => 'total_logins + 1',
        lastLoginAt: () => 'NOW()',
      })
      .where('id = :id', { id })
      .execute();
  }

  // ── 登录失败锁定 ────────────────────────────────────
  isLocked(user: Pick<User, 'lockedUntil'>): boolean {
    return user.lockedUntil !== null && user.lockedUntil > new Date();
  }

  async registerFailedLogin(userId: string): Promise<void> {
    const max = this.config.get<number>('LOGIN_MAX_ATTEMPTS', 5);
    const lockSec = this.config.get<number>('LOGIN_LOCKOUT_SECONDS', 900);

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) return;

    const nextAttempts = user.failedLoginAttempts + 1;
    const shouldLock = nextAttempts >= max;
    await this.userRepo.update(userId, {
      failedLoginAttempts: nextAttempts,
      lockedUntil: shouldLock ? new Date(Date.now() + lockSec * 1000) : user.lockedUntil,
    });
  }

  async resetFailedLogin(userId: string): Promise<void> {
    await this.userRepo.update(userId, {
      failedLoginAttempts: 0,
      lockedUntil: null,
    });
  }

  // ── 统计 (admin 用) ─────────────────────────────────
  async getStatsOverview(scopeToTenantId: number | null | undefined): Promise<{
    total: number;
    active: number;
    suspended: number;
    admins: number;
    operators: number;
    viewers: number;
  }> {
    const scoped = () => {
      const qb = this.userRepo.createQueryBuilder('u').where('u.deleted_at IS NULL');
      if (scopeToTenantId !== undefined && scopeToTenantId !== null) {
        qb.andWhere('u.tenant_id = :tid', { tid: scopeToTenantId });
      } else if (scopeToTenantId === null) {
        qb.andWhere('u.tenant_id IS NULL');
      }
      return qb;
    };

    const [total, active, suspended, admins, operators, viewers] = await Promise.all([
      scoped().getCount(),
      scoped().andWhere('u.status = :s', { s: UserStatus.Active }).getCount(),
      scoped().andWhere('u.status = :s', { s: UserStatus.Suspended }).getCount(),
      scoped().andWhere('u.role = :r', { r: UserRole.Admin }).getCount(),
      scoped().andWhere('u.role = :r', { r: UserRole.Operator }).getCount(),
      scoped().andWhere('u.role = :r', { r: UserRole.Viewer }).getCount(),
    ]);

    return { total, active, suspended, admins, operators, viewers };
  }

  // ── 权限守卫辅助 ────────────────────────────────────
  // 平台超管 (tenantId=null, role=admin) 可访问任何租户用户
  // 租户 admin 只能访问同租户用户
  // 其他 role 只能访问自己
  assertCanAccess(
    current: { id: string; role: string; tenantId: number | null },
    target: User,
  ): void {
    if (current.role === UserRole.Admin && current.tenantId === null) return;
    if (current.role === UserRole.Admin && current.tenantId === target.tenantId) return;
    if (current.id === target.id) return;
    throw new ForbiddenException('无权限访问该用户');
  }

  // ── DTO 序列化 ──────────────────────────────────────
  toResponse(user: User): UserResponseDto {
    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      username: user.username,
      role: user.role,
      status: user.status,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      timezone: user.timezone,
      language: user.language,
      preferences: user.preferences,
      totalLogins: user.totalLogins,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
