// 2026-04-25 · Chromium per-slot runtime · D1 MVP
// 当前实现: 启 Chromium · 加载 about:blank · 验证容器 + Chromium + puppeteer-extra 通路
// 后续 D2-3: 加载 https://web.whatsapp.com · QR 提取 · integrity-checks
// 后续 D4-5: WS 回连控制面 · IPC 命令处理

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import pino from 'pino';
import * as fs from 'node:fs';
import * as path from 'node:path';

const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
});

puppeteer.use(StealthPlugin());

// ═══ 环境变量 ═══════════════════════════════════════════════════════
const SLOT_ID = process.env.SLOT_ID ?? '';
const TENANT_ID = process.env.TENANT_ID ?? '';
const SESSION_DIR = process.env.SESSION_DIR ?? '/app/wa-data';
const CONTROL_PLANE_WS_URL = process.env.CONTROL_PLANE_WS_URL ?? '';
const PROXY_URL = process.env.PROXY_URL ?? ''; // socks5h://user:pass@host:port (C7.3 必须 socks5h · 不是 socks5)
const PROXY_USER = process.env.PROXY_USER ?? '';
const PROXY_PASS = process.env.PROXY_PASS ?? '';
const PUPPETEER_EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH ?? '/usr/bin/chromium';

// ═══ 主流程 (D1 占位 · 后续替换) ════════════════════════════════════

async function main() {
  log.info({ slotId: SLOT_ID, tenantId: TENANT_ID, sessionDir: SESSION_DIR }, 'runtime starting');

  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    log.info({ dir: SESSION_DIR }, 'session dir created');
  }

  const profileDir = path.join(SESSION_DIR, 'profile');

  // ─── Chromium launch args (POC 关键) ────────────────────────────
  const launchArgs: string[] = [
    `--user-data-dir=${profileDir}`,
    '--no-sandbox', // 容器内 (有 chromium-sandbox 包但 docker 通常禁)
    '--disable-dev-shm-usage', // 防 /dev/shm 太小
    '--disable-gpu',
    '--disable-software-rasterizer',
    // C7.3.2 · DNS leak 工程封死
    '--disable-features=AsyncDns,DnsOverHttps',
    '--enable-features=NetworkServiceInProcess',
  ];

  if (PROXY_URL) {
    launchArgs.push(`--proxy-server=${PROXY_URL}`);
    // host-resolver-rules: 强制非 proxy 入口的 host 不本地解析
    // 提取 proxy host (e.g. socks5h://user:pass@gateway.com:1080 → gateway.com)
    const proxyHost = extractProxyHost(PROXY_URL);
    if (proxyHost) {
      launchArgs.push(`--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ${proxyHost}`);
    }
  }

  log.info({ launchArgs }, 'launching chromium');

  const browser = await puppeteer.launch({
    executablePath: PUPPETEER_EXECUTABLE_PATH,
    headless: true,
    args: launchArgs,
    defaultViewport: { width: 1280, height: 800 },
    timeout: 30_000,
  });

  log.info({ pid: browser.process()?.pid }, 'chromium launched');

  const page = (await browser.pages())[0] ?? (await browser.newPage());

  // proxy auth (HTTP/SOCKS · puppeteer 自动处理 SOCKS auth via URL · HTTP 用 page.authenticate)
  if (PROXY_USER && PROXY_URL.startsWith('http')) {
    await page.authenticate({ username: PROXY_USER, password: PROXY_PASS });
  }

  // D1 验证: about:blank · 证明 Chromium 能起 + 能控制
  await page.goto('about:blank', { waitUntil: 'load', timeout: 10_000 });
  log.info('chromium loaded about:blank · D1 baseline OK');

  // 后续 D2-3 替换: page.goto('https://web.whatsapp.com')

  // 占位心跳 · D4-5 替换为 WS heartbeat
  setInterval(() => {
    log.info({ ts: Date.now() }, 'heartbeat (placeholder)');
  }, 30_000);

  // graceful shutdown
  const shutdown = async (signal: string) => {
    log.warn({ signal }, 'shutdown signal received');
    try {
      await browser.close();
    } catch (err) {
      log.error({ err }, 'browser.close failed');
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  log.info('runtime ready · waiting for commands (D4-5 will add WS bridge)');
}

function extractProxyHost(url: string): string | null {
  // socks5h://user:pass@host:port → host
  // http://user:pass@host:port → host
  const m = url.match(/^[a-z0-9+]+:\/\/(?:[^@]+@)?([^:/]+)/i);
  return m ? m[1] : null;
}

main().catch((err) => {
  log.error({ err: err instanceof Error ? { message: err.message, stack: err.stack } : err }, 'fatal');
  process.exit(1);
});
