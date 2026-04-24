import { IsArray, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateChannelItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;

  @IsOptional()
  @IsString()
  inviteCode?: string;

  @IsOptional()
  @IsString()
  jid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsInt()
  subscribers?: number;
}
