import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export enum MediaKind {
  Image = 'image',
  Voice = 'voice',
  File = 'file',
}

// M2 W3: 简化版 base64, 避免引入 multipart.
// 当前 DTO 验证只做 type/length, 不卡 base64 合法性 — Buffer.from 失败时 sendMedia 会 throw.
// WA 限 16 MB/条, base64 膨胀 33% → 约 21.3 MB 原文. class-transformer 默认 bodyParser 上限 100KB,
// main.ts bootstrap 调大 json limit (见 main.ts).
export class SendMediaMessageDto {
  @IsString()
  @IsNotEmpty({ message: '收件人不能为空' })
  to!: string;

  @IsEnum(MediaKind, { message: 'type 必须是 image / voice / file 之一' })
  type!: MediaKind;

  @IsString()
  @IsNotEmpty({ message: 'contentBase64 不能为空' })
  contentBase64!: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  filename?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  caption?: string;
}
