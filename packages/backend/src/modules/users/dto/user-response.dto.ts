import { UserRole, UserStatus } from '../user.entity';

// passwordHash / deleted_at 永不出现, 锁定字段仅 admin 可见
export class UserResponseDto {
  id!: string;
  tenantId!: number | null;
  email!: string;
  username!: string;
  role!: UserRole;
  status!: UserStatus;
  fullName!: string | null;
  avatarUrl!: string | null;
  timezone!: string;
  language!: string;
  preferences!: Record<string, unknown>;
  totalLogins!: number;
  lastLoginAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}
