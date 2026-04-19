// TypeORM CLI 入口 — 不被 NestJS runtime 引用，仅给 `typeorm-ts-node-commonjs` 用
// 用法见 package.json 的 migration:* 脚本
import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { resolve } from 'node:path';

loadEnv({ path: resolve(__dirname, '../../.env') });
loadEnv({ path: resolve(__dirname, '../../.env.local') });

function req(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env ${key} (see .env.example)`);
  return v;
}

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: req('DB_HOST'),
  port: Number(req('DB_PORT')),
  username: req('DB_USERNAME'),
  password: req('DB_PASSWORD'),
  database: req('DB_DATABASE'),
  entities: [resolve(__dirname, '../**/*.entity.{ts,js}')],
  migrations: [resolve(__dirname, './migrations/*.{ts,js}')],
  migrationsTableName: 'migrations',
  synchronize: false,
  logging: ['error', 'warn', 'migration'],
};

export default new DataSource(dataSourceOptions);
