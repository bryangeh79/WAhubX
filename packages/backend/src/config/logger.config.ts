import type { Params } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

// 敏感字段名 · formatters.log hook 里递归剥除
// 用户 2026-04-20 要求: "error stack / HTTP debug log 里不应出现 'sk-' / 'apiKey' / 完整 key 子串"
const SECRET_KEYS = new Set([
  'apiKey',
  'api_key',
  'apiKeyEncrypted',
  'api_key_encrypted',
  'APP_ENCRYPTION_KEY',
  'password',
  'license_key',
  'authorization',
  'cookie',
]);

export function redactSensitive(obj: unknown, depth = 0): unknown {
  if (depth > 8) return obj; // 防递归炸
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((x) => redactSensitive(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEYS.has(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = redactSensitive(v, depth + 1);
    }
  }
  return out;
}

export function buildLoggerConfig(env: NodeJS.ProcessEnv): Params {
  const isDev = env.NODE_ENV !== 'production';
  const level = env.LOG_LEVEL ?? (isDev ? 'debug' : 'info');

  return {
    pinoHttp: {
      level,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = Array.isArray(incoming) ? incoming[0] : (incoming ?? randomUUID());
        res.setHeader('x-request-id', id);
        return id;
      },
      customProps: () => ({ service: 'wahubx-backend' }),
      formatters: {
        log: (obj) => redactSensitive(obj) as Record<string, unknown>,
      },
      redact: {
        // 顶层兜底 (formatters.log 已递归剥, 这里只保 req.headers 双保险)
        paths: ['req.headers.authorization', 'req.headers.cookie'],
        censor: '[REDACTED]',
      },
      transport: isDev
        ? {
            target: 'pino-pretty',
            options: {
              singleLine: true,
              colorize: true,
              translateTime: 'SYS:HH:MM:ss.l',
              ignore: 'pid,hostname,service',
            },
          }
        : undefined,
    },
  };
}
