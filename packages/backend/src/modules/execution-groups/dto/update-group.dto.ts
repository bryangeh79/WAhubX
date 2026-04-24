import { IsArray, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  description?: string;

  // 替换型更新: 传了就是完整成员列表
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  slotIds?: number[];
}
