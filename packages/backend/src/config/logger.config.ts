import type { Params } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';

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
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.license_key',
        ],
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
