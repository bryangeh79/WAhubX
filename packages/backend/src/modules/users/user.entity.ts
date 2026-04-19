import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { TenantEntity } from '../tenants/tenant.entity';

// 改自 FAhubX 的 User.role = 'admin' | 'tenant'
// WAhubX 决策: Users : Tenant = 1:N, role 三档 (admin / operator / viewer)
// - admin: 租户管理员 (tenant_id 必填); 或 tenant_id = NULL 时为平台超管
// - operator: 日常运营
// - viewer: 只读
export enum UserRole {
  Admin = 'admin',
  Operator = 'operator',
  Viewer = 'viewer',
}

export enum UserStatus {
  Active = 'active',
  Suspended = 'suspended',
}

@Entity('users')
@Index('idx_users_tenant_id', ['tenantId'])
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // NULL = 平台超级管理员 (SaaS 运营自己); 非 NULL = 隶属某租户
  @Column({ type: 'int', name: 'tenant_id', nullable: true })
  tenantId!: number | null;

  @ManyToOne(() => TenantEntity, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: TenantEntity | null;

  @Column({ type: 'varchar', length: 255, unique: true })
  @Index('idx_users_email')
  email!: string;

  @Column({ type: 'varchar', length: 100, unique: true })
  username!: string;

  @Exclude()
  @Column({ type: 'varchar', length: 255, name: 'password_hash' })
  passwordHash!: string;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.Operator })
  role!: UserRole;

  @Column({ type: 'enum', enum: UserStatus, default: UserStatus.Active })
  @Index('idx_users_status')
  status!: UserStatus;

  @Column({ type: 'varchar', length: 200, nullable: true, name: 'full_name' })
  fullName!: string | null;

  @Column({ type: 'text', nullable: true, name: 'avatar_url' })
  avatarUrl!: string | null;

  @Column({ type: 'varchar', length: 50, default: 'Asia/Kuala_Lumpur' })
  timezone!: string;

  @Column({ type: 'varchar', length: 10, default: 'zh' })
  language!: string;

  @Column({ type: 'jsonb', default: {} })
  preferences!: Record<string, unknown>;

  // ── 登录统计 ──────────────────────
  @Column({ type: 'int', default: 0, name: 'total_logins' })
  totalLogins!: number;

  @Column({ type: 'timestamptz', nullable: true, name: 'last_login_at' })
  lastLoginAt!: Date | null;

  // ── 登录失败锁定 (决策: 5 次 / 15 分钟) ─────────────────
  @Column({ type: 'int', default: 0, name: 'failed_login_attempts' })
  failedLoginAttempts!: number;

  @Column({ type: 'timestamptz', nullable: true, name: 'locked_until' })
  lockedUntil!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Exclude()
  @DeleteDateColumn({ type: 'timestamptz', nullable: true, name: 'deleted_at' })
  deletedAt!: Date | null;

  @BeforeInsert()
  @BeforeUpdate()
  normalizeIdentifiers() {
    if (this.email) this.email = this.email.toLowerCase().trim();
    if (this.username) this.username = this.username.toLowerCase().trim();
  }

  isActive(): boolean {
    return this.status === UserStatus.Active && !this.deletedAt;
  }

  isLocked(): boolean {
    return this.lockedUntil !== null && this.lockedUntil > new Date();
  }
}
