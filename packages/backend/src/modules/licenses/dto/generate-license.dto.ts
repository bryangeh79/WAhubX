import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { TenantPlan } from '../../tenants/tenant.entity';

// 2026-04-21 · 创建租户 + license · 含 admin 登录凭据 (VPS 模式用)
export class GenerateLicenseDto {
  @IsString()
  @IsNotEmpty({ message: '租户名称不能为空' })
  tenantName!: string;

  @IsEnum(TenantPlan, { message: 'plan 必须是 basic / pro / enterprise 之一' })
  plan!: TenantPlan;

  // 租户 admin 登录邮箱 (必填 · 用户激活时建本地 admin user)
  @IsEmail({}, { message: '租户邮箱格式错误' })
  tenantEmail!: string;

  // 租户 admin 用户名 (必填)
  @IsString()
  @Matches(/^[a-zA-Z0-9_]+$/, { message: '用户名只能字母/数字/下划线' })
  @MinLength(3)
  tenantUsername!: string;

  // 租户 admin 初始密码 (明文 → backend bcrypt → VPS 存 hash)
  @IsString()
  @MinLength(8, { message: '密码至少 8 位' })
  tenantPassword!: string;

  @IsOptional()
  @IsString()
  tenantFullName?: string;

  @IsOptional()
  @IsDateString({}, { message: 'expiresAt 必须是 ISO 日期字符串' })
  @Type(() => String)
  expiresAt?: string;
}
