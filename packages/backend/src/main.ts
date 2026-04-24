import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger as PinoLogger } from 'nestjs-pino';
import { Logger as NestLogger } from '@nestjs/common';
import { AppModule } from './app.module';

// ───────── Global rejection/exception safety net (2026-04-21) ─────────
// 历史 bug: Baileys writeFile ENOENT (session 文件被外部删) → unhandledRejection → 整进程 exit 1 · 客户端宕机
// 修: 全局 catch · 不让单个 slot 的磁盘错误拖死整个 backend. 参考 dogfood-issues.md CRITICAL 条.
const bootstrapLogger = new NestLogger('GlobalSafetyNet');
process.on('unhandledRejection', (reason: unknown, promise) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  // Baileys 文件系统异常 / WebSocket 异常 / Proxy 异常 最常见 → 不 crash
  bootstrapLogger.error(
    `unhandledRejection (process kept alive): ${err.message}`,
    err.stack,
  );
  // 如果是 Baileys session 文件缺失, 额外提示
  if (err.message?.includes('ENOENT') && err.message?.includes('wa-session')) {
    bootstrapLogger.warn(
      'Baileys session 文件缺失 · 相关槽位需要重新扫码绑定 · 已保留 backend 存活',
    );
  }
});
process.on('uncaughtException', (err: Error) => {
  bootstrapLogger.error(
    `uncaughtException (process kept alive): ${err.message}`,
    err.stack,
  );
  // 真正致命异常 (如 OOM) Node 会自己死 · 这里只拦可恢复的
});

async function bootstrap() {
  // bodyParser=false 关默认 parser, 之后用 useBodyParser 自定义 limit
  // 媒体消息 base64 在 JSON body 里送, 25MB: 16MB WA 上限 × base64 1.33x + 头部余量
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  app.useBodyParser('json', { limit: '25mb' });
  app.useBodyParser('urlencoded', { limit: '25mb', extended: true });

  app.useLogger(app.get(PinoLogger));
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3000);
  await app.listen(port);

  const logger = app.get(PinoLogger);
  logger.log(`WAhubX backend listening on http://localhost:${port}/api/v1`);
}

void bootstrap();
