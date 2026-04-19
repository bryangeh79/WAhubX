import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class VerifyLicenseDto {
  @IsString()
  @IsNotEmpty({ message: '请提供 License Key' })
  licenseKey!: string;

  // 若不提供, 后端会用本机 machineId; 生产 VPS License Server 版会强制要求客户端传
  @IsOptional()
  @IsString()
  machineFingerprint?: string;
}
