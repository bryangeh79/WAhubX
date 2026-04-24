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
import { OpeningLineStatus } from '../entities/opening-line.entity';

export class OpeningLineVariantDto {
  @IsInt()
  @Min(1)
  index!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  content!: string;

  @IsBoolean()
  enabled!: boolean;
}

export class CreateOpeningLineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  content!: string;

  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;
}

export class UpdateOpeningLineDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  content?: string;

  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => OpeningLineVariantDto)
  variants?: OpeningLineVariantDto[];

  @IsOptional()
  @IsEnum(OpeningLineStatus)
  status?: OpeningLineStatus;
}

export class GenerateOpeningVariantsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  count?: number;

  @IsOptional()
  @IsBoolean()
  append?: boolean;
}
