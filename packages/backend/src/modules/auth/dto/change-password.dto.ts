import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: '当前密码不能为空' })
  currentPassword!: string;

  @IsString()
  @IsNotEmpty({ message: '新密码不能为空' })
  @MinLength(8, { message: '新密码长度不能少于 8 个字符' })
  newPassword!: string;
}
