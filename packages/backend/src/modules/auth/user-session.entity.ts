import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { User } from '../users/user.entity';

@Entity('user_sessions')
@Index('idx_user_sessions_user_id', ['userId'])
@Index('idx_user_sessions_expires_at', ['expiresAt'])
export class UserSession {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  // 实际生产更稳妥的做法是只存 token hash. V1 先存明文 + DB 加密 at-rest;
  // M8/M10 的安全 hardening 再改成 sha256 fingerprint 查找.
  @Exclude()
  @Column({ type: 'text', name: 'access_token' })
  @Index('idx_user_sessions_access_token')
  accessToken!: string;

  @Exclude()
  @Column({ type: 'text', name: 'refresh_token' })
  @Index('idx_user_sessions_refresh_token')
  refreshToken!: string;

  @Column({ type: 'jsonb', nullable: true, name: 'device_info' })
  deviceInfo!: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true, name: 'user_agent' })
  userAgent!: string | null;

  @Column({ type: 'varchar', length: 45, nullable: true, name: 'ip_address' })
  ipAddress!: string | null;

  @Column({ type: 'boolean', default: false })
  revoked!: boolean;

  @Column({ type: 'timestamptz', nullable: true, name: 'revoked_at' })
  revokedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt!: Date;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  isExpired(): boolean {
    return new Date() > this.expiresAt;
  }

  isValid(): boolean {
    return !this.revoked && !this.isExpired();
  }
}
