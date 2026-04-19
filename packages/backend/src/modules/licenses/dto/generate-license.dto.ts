import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { TenantPlan } from '../../tenants/tenant.entity';

// Admin 创建 license + 租户 (一次性绑定套餐)
export class GenerateLicenseDto {
  @IsString()
  @IsNotEmpty({ message: '租户名称不能为空' })
  tenantName!: string;

  @IsEnum(TenantPlan, { message: 'plan 必须是 basic / pro / enterprise 之一' })
  plan!: TenantPlan;

  @IsOptional()
  @IsEmail({}, { message: '租户邮箱格式错误' })
  tenantEmail?: string;

  @IsOptional()
  @IsDateString({}, { message: 'expiresAt 必须是 ISO 日期字符串' })
  @Type(() => String)
  expiresAt?: string;
}
