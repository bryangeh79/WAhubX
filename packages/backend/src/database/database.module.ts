import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { resolve } from 'node:path';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.getOrThrow<string>('DB_HOST'),
        port: config.getOrThrow<number>('DB_PORT'),
        username: config.getOrThrow<string>('DB_USERNAME'),
        password: config.getOrThrow<string>('DB_PASSWORD'),
        database: config.getOrThrow<string>('DB_DATABASE'),
        entities: [resolve(__dirname, '../**/*.entity.{ts,js}')],
        // 生产环境严禁 synchronize — 全部靠 migration
        synchronize: false,
        autoLoadEntities: true,
        logging: ['error', 'warn', 'migration'],
        retryAttempts: 3,
        retryDelay: 2000,
      }),
    }),
  ],
})
export class DatabaseModule {}
