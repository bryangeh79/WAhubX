import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User, UserRole, UserStatus } from './user.entity';

// 改自 FAhubX UsersService. 裁剪到 M1 auth 所需最小方法集:
//   count / findByEmail / findByUsername / findOne / validatePassword
//   updatePassword / updateLoginStats
// 加锁定三件套: registerFailedLogin / resetFailedLogin / isLocked
// 加租户授权入口: createForTenant (由 license 激活流程调用, 任务 2.3)
// 完整 CRUD / preferences / admin-users 放 V2 或后续任务.
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

  async validatePassword(user: Pick<User, 'passwordHash'>, password: string): Promise<boolean> {
    if (!user.passwordHash) return false;
    return bcrypt.compare(password, user.passwordHash);
  }

  async updatePassword(id: string, newPassword: string): Promise<void> {
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

  // ── 租户级用户授权入口 (license 激活时调用; 任务 2.3 再接通) ─────────
  async createForTenant(params: {
    tenantId: number | null;
    email: string;
    username: string;
    password: string;
    role?: UserRole;
    fullName?: string;
    language?: string;
    timezone?: string;
  }): Promise<User> {
    const existingEmail = await this.findByEmail(params.email);
    if (existingEmail) throw new ConflictException('该邮箱地址已被注册');
    const existingUsername = await this.findByUsername(params.username);
    if (existingUsername) throw new ConflictException('该用户名已被使用');

    if (!params.password || params.password.length < 8) {
      throw new BadRequestException('密码长度至少 8 位');
    }

    const passwordHash = await bcrypt.hash(params.password, this.bcryptRounds());
    const user = this.userRepo.create({
      tenantId: params.tenantId,
      email: params.email,
      username: params.username,
      passwordHash,
      role: params.role ?? UserRole.Admin,
      status: UserStatus.Active,
      fullName: params.fullName ?? null,
      language: params.language ?? 'zh',
      timezone: params.timezone ?? 'Asia/Kuala_Lumpur',
      preferences: {},
    });
    return this.userRepo.save(user);
  }

  // ── 登录失败锁定 (决策: 5 次 / 15 分钟) ───────────────
  isLocked(user: Pick<User, 'lockedUntil'>): boolean {
    return user.lockedUntil !== null && user.lockedUntil > new Date();
  }

  /**
   * 登录失败: attempts++; 达到 MAX → 锁 LOGIN_LOCKOUT_SECONDS.
   * 返回更新后的 user (仅需 failedLoginAttempts / lockedUntil).
   */
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
}
