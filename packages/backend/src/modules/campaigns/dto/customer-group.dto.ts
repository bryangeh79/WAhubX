import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateCustomerGroupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;
}

export class UpdateCustomerGroupDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;
}

export class ImportPasteDto {
  // 多行文本 / 逗号分隔号码, service 负责解析 + 规范化 + 去重
  @IsString()
  @MinLength(1)
  @MaxLength(100_000)
  raw!: string;
}

export class PickContactsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  contactIds!: number[];
}
