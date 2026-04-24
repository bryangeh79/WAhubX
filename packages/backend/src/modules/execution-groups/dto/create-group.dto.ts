import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateGroupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  description?: string;

  // 用户 2026-04-21 决议: 最少 1 成员, 最多 = 租户 slot_limit (Enterprise 50)
  @IsArray()
  @ArrayMinSize(1, { message: '组至少 1 个成员' })
  @ArrayMaxSize(100, { message: '组成员数超过上限 100' })
  @IsInt({ each: true })
  slotIds!: number[];
}
