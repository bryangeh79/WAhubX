import { IsArray, IsOptional, IsString } from 'class-validator';

export class BulkImportDto {
  /** CSV content · header: name,invite_code,tags (tags 用 | 分隔) */
  @IsString()
  csv!: string;

  @IsOptional()
  @IsString()
  defaultTag?: string;
}

export class PickRandomDto {
  /** 按 tag 筛 · 空数组 = 不筛 (全库随机) */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  /** 数量 · 1-50 */
  @IsOptional()
  count?: number;

  /** 是否仅 global 种子 · false = 种子 + 本租户 */
  @IsOptional()
  onlyGlobal?: boolean;
}
