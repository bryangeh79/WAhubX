import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

// 客户本机激活: 输入 key + 首个 admin 凭据
// 激活时自动做的事 (task 2.3 事务):
//   1. 校验 license 存在 / 未吊销 / 未过期 / 未绑定
//   2. 找到 license 关联的 tenant (admin 生成时已预分配)
//   3. 创建 admin user (role=admin, tenant_id=该租户)
//   4. 写入 license.machine_fingerprint = 本机 machineId, issued_at = now
//   5. 返回 tokens (相当于自动登录)
export class ActivateLicenseDto {
  @IsString()
  @IsNotEmpty({ message: '请输入 License Key' })
  licenseKey!: string;

  @IsEmail({}, { message: '邮箱格式错误' })
  adminEmail!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-zA-Z0-9_]+$/, { message: '用户名只能包含字母、数字和下划线' })
  @MinLength(3)
  adminUsername!: string;

  @IsString()
  @MinLength(8, { message: '密码长度至少 8 位' })
  adminPassword!: string;

  @IsOptional()
  @IsString()
  adminFullName?: string;
}
