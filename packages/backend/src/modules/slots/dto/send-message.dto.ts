import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SendTextMessageDto {
  // 手机号 (60123456789) 或完整 JID (60123456789@s.whatsapp.net)
  @IsString()
  @IsNotEmpty({ message: '收件人不能为空' })
  to!: string;

  @IsString()
  @IsNotEmpty({ message: '消息内容不能为空' })
  @MaxLength(4096, { message: '单条文本消息最长 4096 字符' })
  text!: string;
}
