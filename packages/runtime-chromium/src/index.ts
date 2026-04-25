// 2026-04-25 · Chromium per-slot runtime · D2
// 锁定范围 (4 步):
//   D2 Step 1: about:blank → https://web.whatsapp.com (页面稳定打开)
//   D2 Step 2: selector 探测 · 仅识别 qr / chat-list
//   D2 Step 3: 每个阶段截 screenshot + HTML + url/title 落 diagnostics/
//   D2 Step 4: 若 qr 状态 · 提 canvas.toDataURL 输出原始值 (不接 WS)
//
// 不在 D2 范围:
//   - WS bridge 协议 (D4-5)
//   - integrity-checks 真实装 (D3 · 当前 stub 直接通过)
//   - bind/send/inbound 自动化 (W2)

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import pino from 'pino';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { runStartupChecks, IntegrityCheckFailedError } from './integrity-checks/startup-checks';
import { loadWaWebAndDetect } from './wa-web/wa-web-loader';

const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
});

puppeteer.use(StealthPlugin());

// ═══ 环境变量 ═══════════════════════════════════════════════════════
const SLOT_ID = process.env.SLOT_ID ?? '';
const TENANT_ID = process.env.TENANT_ID ?? '';
const SESSION_DIR = process.env.SESSION_DIR ?? '/app/wa-data';
const PROXY_URL = process.env.PROXY_URL ?? '';
const PROXY_USER = process.env.PROXY_USER ?? '';
const PROXY_PASS = process.env.PROXY_PASS ?? '';
const PUPPETEER_EXECUTABLE_PATH = process.env.PUPPETEER_EXECUTABLE_PATH ?? '/usr/bin/chromium';

const HOST_PUBLIC_IP = process.env.HOST_PUBLIC_IP ?? '';

// 2026-04-25 · D5 · UA 强制覆盖 · 已实锤破绽: 默认 UA 含 "HeadlessChrome" → WA 拒
// 默认: Linux x86_64 + Chrome 147 (匹配容器实际 chromium 版本)
// 生产应由 fingerprint.ts 派生 · 但 D5 范围只修这一条破绽 · 先用静态默认值
const USER_AGENT =
  process.env.USER_AGENT ??
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

// ═══ 主流程 ════════════════════════════════════════════════════════

async function main() {
  log.info({ slotId: SLOT_ID, tenantId: TENANT_ID, sessionDir: SESSION_DIR }, 'runtime starting');

  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
    log.info({ dir: SESSION_DIR }, 'session dir created');
  }

  const profileDir = path.join(SESSION_DIR, 'profile');
  const diagnosticsDir = path.join(SESSION_DIR, 'diagnostics');
  fs.mkdirSync(diagnosticsDir, { recursive: true });

  // ─── Chromium launch args ────────────────────────────────────
  const launchArgs: string[] = [
    `--user-data-dir=${profileDir}`,
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    // C7.3.2 · DNS leak 工程封死
    '--disable-features=AsyncDns,DnsOverHttps',
    '--enable-features=NetworkServiceInProcess',
    // D5 · Layer 1 · UA 覆盖 (已实锤破绽: 默认 UA 含 HeadlessChrome → WA 拒)
    `--user-agent=${USER_AGENT}`,
  ];

  if (PROXY_URL) {
    launchArgs.push(`--proxy-server=${PROXY_URL}`);
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

  // D5 · Layer 2 · page.setUserAgent (覆盖 navigator.userAgent + 出站请求 header)
  await page.setUserAgent(USER_AGENT);
  log.info({ ua: USER_AGENT }, 'D5 page.setUserAgent applied');

  // D5 · Layer 3 · CDP Network.setUserAgentOverride (彻底覆盖 · 含子 frame 和 service worker)
  // userAgentMetadata 必须跟 UA 一致 · 否则 Client Hints 揭穿
  try {
    const cdp = await page.createCDPSession();
    await cdp.send('Network.setUserAgentOverride', {
      userAgent: USER_AGENT,
      acceptLanguage: 'en-US,en;q=0.9',
      platform: 'Linux x86_64',
      userAgentMetadata: {
        brands: [
          { brand: 'Not_A Brand', version: '8' },
          { brand: 'Chromium', version: '147' },
          { brand: 'Google Chrome', version: '147' },
        ],
        fullVersionList: [
          { brand: 'Not_A Brand', version: '8.0.0.0' },
          { brand: 'Chromium', version: '147.0.0.0' },
          { brand: 'Google Chrome', version: '147.0.0.0' },
        ],
        platform: 'Linux',
        platformVersion: '6.1.0',
        architecture: 'x86',
        bitness: '64',
        wow64: false,
        model: '',
        mobile: false,
      },
    } as Parameters<typeof cdp.send>[1]);
    log.info('D5 CDP Network.setUserAgentOverride applied (incl. userAgentMetadata)');
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, 'CDP UA override failed · falling back to layer 1+2');
  }

  // proxy auth (HTTP 代理才需 · SOCKS auth 走 URL)
  if (PROXY_USER && PROXY_URL.startsWith('http')) {
    await page.authenticate({ username: PROXY_USER, password: PROXY_PASS });
  }

  // ─── D3 · integrity-checks · fail-fast 不进 WA Web ────────────
  try {
    const checkReport = await runStartupChecks({
      page,
      launchArgs,
      proxyUrl: PROXY_URL || null,
      proxyAuth: PROXY_USER && PROXY_PASS ? { user: PROXY_USER, pass: PROXY_PASS } : undefined,
      hostPublicIp: HOST_PUBLIC_IP || null,
      diagnosticsDir,
      log,
    });
    log.info(
      {
        overallPass: checkReport.overallPass,
        durationMs: checkReport.durationMs,
        reportPath: checkReport.reportPath,
        checks: checkReport.checks.map((c) => ({ name: c.name, pass: c.pass, durationMs: c.durationMs })),
      },
      'startup-checks done',
    );
  } catch (err) {
    if (err instanceof IntegrityCheckFailedError) {
      log.error({ check: err.check, message: err.message }, 'integrity FAIL · runtime exiting code=2');
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
      process.exit(2);
    }
    throw err;
  }

  // ─── D2 Step 1-4 · 加载 WA Web + 状态识别 + 截图证据 ────────────
  const result = await loadWaWebAndDetect(page, diagnosticsDir, log);

  log.info(
    {
      state: result.state,
      selector: result.selector,
      qrExtracted: !!result.qrCanvasDataUrl,
      evidenceCount: result.evidence.length,
      evidenceFiles: result.evidence.map((e) => e.pngPath),
    },
    'D2 wa-web load + state detect complete',
  );

  // 把 QR raw data URL 写到 diagnostics (后续控制面用)
  if (result.qrCanvasDataUrl) {
    const qrPath = path.join(diagnosticsDir, 'last-qr.dataurl.txt');
    fs.writeFileSync(qrPath, result.qrCanvasDataUrl, 'utf-8');
    log.info({ path: qrPath, bytes: result.qrCanvasDataUrl.length }, 'QR data URL persisted');
  }

  // ─── 占位心跳 (D4-5 替换为 WS) ────────────────────────────────
  setInterval(() => {
    log.info({ ts: Date.now(), state: result.state }, 'heartbeat (placeholder)');
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

  log.info('runtime ready · D4-5 will add WS bridge');
}

function extractProxyHost(url: string): string | null {
  const m = url.match(/^[a-z0-9+]+:\/\/(?:[^@]+@)?([^:/]+)/i);
  return m ? m[1] : null;
}

main().catch((err) => {
  log.error(
    { err: err instanceof Error ? { message: err.message, stack: err.stack } : err },
    'fatal',
  );
  process.exit(1);
});
