import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AdvertisementStatus } from '../entities/advertisement.entity';

export class AdvertisementVariantDto {
  @IsInt()
  @Min(1)
  index!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  content!: string;

  @IsBoolean()
  enabled!: boolean;
}

export class CreateAdvertisementDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  content!: string;

  @IsOptional()
  @IsInt()
  assetId?: number | null;

  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;
}

export class UpdateAdvertisementDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  content?: string;

  @IsOptional()
  @IsInt()
  assetId?: number | null;

  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => AdvertisementVariantDto)
  variants?: AdvertisementVariantDto[];

  @IsOptional()
  @IsEnum(AdvertisementStatus)
  status?: AdvertisementStatus;
}

export class GenerateVariantsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  count?: number;

  // true = 追加到现有池 (不删旧的) · false/缺省 = 清空重生成
  @IsOptional()
  @IsBoolean()
  append?: boolean;
}
