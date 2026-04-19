import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { ProxyType } from '../proxy.entity';

export class CreateProxyDto {
  @IsEnum(ProxyType, { message: 'proxyType 必须是 residential_static / residential_rotating / datacenter' })
  proxyType!: ProxyType;

  @IsString()
  @IsNotEmpty()
  host!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  city?: string;
}
