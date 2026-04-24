import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ProxyType } from '../proxy.entity';

export class UpdateProxyDto {
  @IsOptional()
  @IsEnum(ProxyType)
  proxyType?: ProxyType;

  @IsOptional()
  @IsString()
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsString()
  username?: string | null;

  @IsOptional()
  @IsString()
  password?: string | null;

  @IsOptional()
  @IsString()
  country?: string | null;

  @IsOptional()
  @IsString()
  city?: string | null;
}
