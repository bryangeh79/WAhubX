import { plainToInstance, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export enum LogLevel {
  Trace = 'trace',
  Debug = 'debug',
  Info = 'info',
  Warn = 'warn',
  Error = 'error',
  Fatal = 'fatal',
  Silent = 'silent',
}

export class EnvSchema {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsEnum(LogLevel)
  LOG_LEVEL: LogLevel = LogLevel.Info;

  // ───────── Database (required) ─────────
  @IsString()
  DB_HOST!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT!: number;

  @IsString()
  DB_USERNAME!: string;

  @IsString()
  DB_PASSWORD!: string;

  @IsString()
  DB_DATABASE!: string;

  // ───────── JWT (required) ─────────
  @IsString()
  JWT_ACCESS_SECRET!: string;

  @IsString()
  JWT_REFRESH_SECRET!: string;

  @IsString()
  JWT_ACCESS_TTL: string = '15m';

  @IsString()
  JWT_REFRESH_TTL: string = '7d';

  // ───────── Auth lockout ─────────
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  LOGIN_MAX_ATTEMPTS: number = 5;

  @Type(() => Number)
  @IsInt()
  @Min(60)
  @Max(86400)
  LOGIN_LOCKOUT_SECONDS: number = 900;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(4)
  @Max(15)
  BCRYPT_ROUNDS?: number;

  // ───────── Redis / BullMQ (M3) ─────────
  @IsString()
  REDIS_HOST: string = 'localhost';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT: number = 6380;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(15)
  REDIS_DB?: number;

  // ───────── 调度器 (M3) ─────────
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  SCHEDULER_MAX_CONCURRENCY: number = 6;

  @Type(() => Number)
  @IsInt()
  @Min(500)
  @Max(60000)
  SCHEDULER_POLL_INTERVAL_MS: number = 3000;

  @IsString()
  SCHEDULER_NIGHT_WINDOW_START: string = '02:00';

  @IsString()
  SCHEDULER_NIGHT_WINDOW_END: string = '06:00';

  // ───────── AI 层 (M6) ─────────
  // 主密钥: 32 bytes hex (64 hex chars). M6 用 EnvMasterKeyProvider 读本值;
  // M10 计划接入 MachineBoundMasterKeyProvider 派生自机器指纹, 不再强依赖 env.
  // 生产必填; dev / test 缺失会抛, prompt 用户生成 openssl rand -hex 32
  @IsString()
  APP_ENCRYPTION_KEY!: string;

  // 全局开关: AI 文本改写. false → ScriptRunner.resolveText 永走 content_pool.
  // 运行时改通过 /ai-settings/text-enable API (M6), env 是冷启动默认.
  @IsString()
  AI_TEXT_ENABLED: string = 'false';
}

export function validateEnv(config: Record<string, unknown>): EnvSchema {
  const validated = plainToInstance(EnvSchema, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(`Invalid environment variables:\n${errors.toString()}`);
  }
  return validated;
}
