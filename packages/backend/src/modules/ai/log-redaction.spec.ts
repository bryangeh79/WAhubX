import pino from 'pino';
import { buildLoggerConfig, redactSensitive } from '../../config/logger.config';

// Key 日志脱敏验证 · 用户 2026-04-20 明确要求
// "error stack / HTTP debug log 里不应出现 'sk-' / 'apiKey' / 完整 key 子串"
describe('Log redaction · API keys never leak', () => {
  const fakeSecret = 'sk-abc1234567890XYZsecretShouldNeverLeak';

  function captureLogs(fn: (logger: pino.Logger) => void): string {
    const chunks: string[] = [];
    const config = buildLoggerConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv);
    const redactCfg = (config.pinoHttp as { redact: pino.redactOptions }).redact;
    const formatters = (config.pinoHttp as { formatters?: pino.LoggerOptions['formatters'] }).formatters;
    const stream = {
      write: (chunk: string) => {
        chunks.push(chunk);
      },
    };
    const logger = pino({ level: 'debug', redact: redactCfg, formatters }, stream);
    fn(logger);
    return chunks.join('');
  }

  it('recursive redactSensitive helper catches arbitrary depth', () => {
    const input = { a: { b: { c: { apiKey: fakeSecret } } } };
    const out = JSON.stringify(redactSensitive(input));
    expect(out).not.toContain(fakeSecret);
    expect(out).toContain('[REDACTED]');
  });


  it('req.body.apiKey is redacted', () => {
    const out = captureLogs((logger) => {
      logger.info({ req: { body: { apiKey: fakeSecret } } }, 'create provider');
    });
    expect(out).not.toContain(fakeSecret);
    expect(out).toContain('[REDACTED]');
  });

  it('req.body.api_key (snake_case) is redacted', () => {
    const out = captureLogs((logger) => {
      logger.info({ req: { body: { api_key: fakeSecret } } }, 'create provider');
    });
    expect(out).not.toContain(fakeSecret);
  });

  it('nested apiKey anywhere in log object is redacted', () => {
    const out = captureLogs((logger) => {
      logger.info({ ctx: { provider: { apiKey: fakeSecret } } }, 'test call');
    });
    expect(out).not.toContain(fakeSecret);
  });

  it('apiKeyEncrypted ciphertext is redacted', () => {
    const fakeCipher = 'gcm:v1:aabbcc:ddeeff112233:445566';
    const out = captureLogs((logger) => {
      logger.info({ provider: { apiKeyEncrypted: fakeCipher } }, 'loaded');
    });
    expect(out).not.toContain(fakeCipher);
  });

  it('APP_ENCRYPTION_KEY is redacted', () => {
    const fakeMasterKey = 'deadbeef'.repeat(8);
    const out = captureLogs((logger) => {
      logger.info({ env: { APP_ENCRYPTION_KEY: fakeMasterKey } }, 'env dump');
    });
    expect(out).not.toContain(fakeMasterKey);
  });

  it('Authorization header is redacted', () => {
    const out = captureLogs((logger) => {
      logger.info({ req: { headers: { authorization: `Bearer ${fakeSecret}` } } }, 'req in');
    });
    expect(out).not.toContain(fakeSecret);
  });
});
