import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserSession } from './user-session.entity';
import { UserSessionService } from './user-session.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserSession]),
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          // @nestjs/jwt v11 expects ms.StringValue 模板字面量 — 从动态 env 读时需要断言
          expiresIn: config.get<string>('JWT_ACCESS_TTL', '15m') as unknown as number,
        },
      }),
    }),
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, UserSessionService, JwtAuthGuard, RolesGuard, JwtStrategy],
  exports: [AuthService, UserSessionService, JwtAuthGuard, RolesGuard, JwtModule],
})
export class AuthModule {}
