import { IsString, MaxLength, MinLength, IsIn, IsOptional } from 'class-validator';

export class AcquireTakeoverDto {
  // reserved for V2 steal-from · V1 接收但忽略
  @IsOptional()
  @IsString()
  note?: string;
}

export class SendTextDto {
  // 目标 JID (60123456789@s.whatsapp.net) 或纯手机号 · baileys 会 normalize
  @IsString()
  @MinLength(3)
  @MaxLength(128)
  to!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  text!: string;
}

export class SendMediaMetaDto {
  @IsString()
  @MinLength(3)
  @MaxLength(128)
  to!: string;

  @IsIn(['image', 'voice', 'file'])
  type!: 'image' | 'voice' | 'file';

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  caption?: string;
}

export class ListMessagesQueryDto {
  // Query params 到 express 永远是字符串 · 用 @IsNumberString 兼容 DTO pipe 校验
  // controller 内用 Number() 转回数字
  @IsOptional()
  @IsString()
  contactId?: string;

  @IsOptional()
  @IsString()
  limit?: string;

  @IsOptional()
  @IsString()
  beforeId?: string; // chat_message.id (bigint as string)
}
