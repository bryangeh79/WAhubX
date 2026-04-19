import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from './config/env.validation';
import { buildLoggerConfig } from './config/logger.config';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { HealthModule } from './modules/health/health.module';
import { LicenseModule } from './modules/licenses/license.module';
import { ProxiesModule } from './modules/proxies/proxies.module';
import { SlotsModule } from './modules/slots/slots.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      envFilePath: ['.env', '.env.local'],
    }),
    LoggerModule.forRoot(buildLoggerConfig(process.env)),
    DatabaseModule,
    UsersModule,
    AuthModule,
    ProxiesModule,
    SlotsModule,
    TenantsModule,
    LicenseModule,
    TasksModule,
    HealthModule,
  ],
  providers: [
    // 默认所有路由受保护; 公开路由用 @Public() 解开 (参见 decorators/public.decorator.ts)
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
