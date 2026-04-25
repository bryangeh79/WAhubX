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
import { waitForLogin } from './wa-web/wait-for-login';
import { startQrLiveServer } from './qr-live-server';
import { detectCountry } from './wa-web/detect-country';
import { injectStealthOverrides } from './wa-web/stealth-inject';
import { IdleActivityScheduler } from './idle-activity';
import { RuntimeWsClient } from './runtime-ws-client';

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

// 2026-04-25 · D7-3 · 国家显式覆盖 · 不设则 ipinfo.io 探测
// 例: PROXY_COUNTRY=MY (绕过探测 · 运维已知场景)
const PROXY_COUNTRY = process.env.PROXY_COUNTRY ?? '';

// 2026-04-25 · D7-1 · 行为模拟开关 (Codex 拍板护栏 · soak A/B 用)
// 默认 true · 设 'false' 完全关闭 idle 行为模拟
const HUMAN_BEHAVIOR_ENABLED = process.env.HUMAN_BEHAVIOR_ENABLED !== 'false';

// 2026-04-25 · D7-1 · soak 模式开关
// 默认 false (D6 测模式 · 登录后 close)
// 设 'true' = 登录后不 close · 启 idle 调度器 · 24h 长跑
const SOAK_MODE = process.env.SOAK_MODE === 'true';

// 2026-04-25 · D8-1 · 控制面 WS 桥
// 不设 = standalone 跑 (D6 测) · 设了 = 连 backend 控制面
// 例: ws://host.docker.internal:9711/runtime
const CONTROL_PLANE_WS_URL = process.env.CONTROL_PLANE_WS_URL ?? '';
const RUNTIME_AUTH_TOKEN = process.env.RUNTIME_AUTH_TOKEN ?? 'dev-runtime-token';

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

  // ─── D7-3 · 国家探测 + locale 一组参数 ────────────────────────
  // 关键: 让 WA 看到的国籍画像全栈一致 (timezone / locale / lang / Accept-Language)
  // UK SIM 在马来 IP + en-US locale + Asia/KL timezone = 三处冲突 = 必踢
  const countryResult = await detectCountry({
    proxyUrl: PROXY_URL || null,
    proxyAuth: PROXY_USER && PROXY_PASS ? { user: PROXY_USER, pass: PROXY_PASS } : undefined,
    envCountry: PROXY_COUNTRY || null,
    log,
  });
  log.info(
    {
      country: countryResult.locale.country,
      timezone: countryResult.locale.timezone,
      locale: countryResult.locale.locale,
      languages: countryResult.locale.languages,
      detectedRaw: countryResult.detectedCountry,
      source: countryResult.source,
      fallback: countryResult.fallback,
      durationMs: countryResult.durationMs,
    },
    'D7-3 country/locale resolved',
  );
  const localeParams = countryResult.locale;

  // ─── Chromium launch args ────────────────────────────────────
  // 注意: 不在这里加 --user-data-dir · puppeteer 会忽略 args 里的此 flag
  // 并强行追加自己的 /tmp/puppeteer_dev_profile-XXX · 导致最终 chromium 用的是 temp 目录
  // 必须用 launch({ userDataDir }) 顶层选项 · 才能让我们的 profileDir 生效
  // (D6 实测踩坑: ps -ef 看到两个 --user-data-dir · 后者 win)
  const launchArgs: string[] = [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    // C7.3.2 · DNS leak 工程封死
    '--disable-features=AsyncDns,DnsOverHttps',
    '--enable-features=NetworkServiceInProcess',
    // D5 · Layer 1 · UA 覆盖 (已实锤破绽: 默认 UA 含 HeadlessChrome → WA 拒)
    `--user-agent=${USER_AGENT}`,
    // D7-3 · 启动语言跟代理国家联动
    `--lang=${localeParams.locale}`,
  ];

  // D6 · 远程调试 · 让 host 浏览器访问容器 chromium 实时屏幕 · 扫活 QR
  // (WA Web QR 跟当下 WS session 强绑 · 截图 PNG 扫不上 · 必须看活 canvas)
  const REMOTE_DEBUGGING = process.env.REMOTE_DEBUGGING === 'true';
  if (REMOTE_DEBUGGING) {
    launchArgs.push('--remote-debugging-port=9222');
    launchArgs.push('--remote-debugging-address=0.0.0.0');
    // Chromium 111+ 要求显式 allow origin · 否则 /json/* 返 empty
    launchArgs.push('--remote-allow-origins=*');
  }

  if (PROXY_URL) {
    launchArgs.push(`--proxy-server=${PROXY_URL}`);
    const proxyHost = extractProxyHost(PROXY_URL);
    if (proxyHost) {
      launchArgs.push(`--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ${proxyHost}`);
    }
  }

  log.info({ launchArgs, userDataDir: profileDir }, 'launching chromium');

  const browser = await puppeteer.launch({
    executablePath: PUPPETEER_EXECUTABLE_PATH,
    headless: true,
    args: launchArgs,
    userDataDir: profileDir, // ← 必须顶层传 · args 里加 --user-data-dir 会被 puppeteer 忽略
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
  // D7-3 · acceptLanguage 跟代理国家联动 (不再写死 en-US)
  try {
    const cdp = await page.createCDPSession();
    await cdp.send('Network.setUserAgentOverride', {
      userAgent: USER_AGENT,
      acceptLanguage: localeParams.acceptLanguage, // D7-3 · 国家驱动
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
    log.info(
      { acceptLanguage: localeParams.acceptLanguage },
      'D5+D7-3 CDP Network.setUserAgentOverride applied (UA + acceptLanguage)',
    );

    // D7-3 · CDP Emulation.setTimezoneOverride (跟代理国家联动)
    // 不设的话 · headless Chromium 会用系统时区 (容器内是 UTC) · 跟代理国家不一致
    try {
      await cdp.send('Emulation.setTimezoneOverride', {
        timezoneId: localeParams.timezone,
      } as Parameters<typeof cdp.send>[1]);
      log.info({ timezone: localeParams.timezone }, 'D7-3 CDP setTimezoneOverride applied');
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : err }, 'D7-3 setTimezoneOverride failed');
    }

    // D7-3 · CDP Emulation.setLocaleOverride (Intl.* 全套跟着改)
    try {
      await cdp.send('Emulation.setLocaleOverride', {
        locale: localeParams.locale,
      } as Parameters<typeof cdp.send>[1]);
      log.info({ locale: localeParams.locale }, 'D7-3 CDP setLocaleOverride applied');
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : err }, 'D7-3 setLocaleOverride failed');
    }
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, 'CDP UA override failed · falling back to layer 1+2');
  }

  // proxy auth (HTTP 代理才需 · SOCKS auth 走 URL)
  if (PROXY_USER && PROXY_URL.startsWith('http')) {
    await page.authenticate({ username: PROXY_USER, password: PROXY_PASS });
  }

  // ─── D7-2 · 深度 stealth 注入 ────────────────────────────────
  // 必须在 page.goto WA Web 之前 · 这样 evaluateOnNewDocument 在 WA JS 之前跑
  // 4 项: navigator.languages clean / Intl.resolvedOptions / permissions.query / chrome.runtime
  try {
    await injectStealthOverrides(page, localeParams, log);
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, 'D7-2 stealth inject failed · 继续走但反检测可能减弱');
  }

  // ─── D8-1 · 启 WS client (尽早 · 不阻塞主流程) ─────────────────
  // 必须在 wait-for-login 之前启 · 否则 QR 阶段 main 阻塞 · WS 永远不连
  // pageState 用 mutable g_state 异步同步 · 主流程更新值即可
  let g_state: 'qr' | 'chat-list' | 'splash' | 'splash-stuck' | 'unknown' | 'connecting' | 'closed' = 'connecting';
  let wsClient: RuntimeWsClient | null = null;
  if (CONTROL_PLANE_WS_URL) {
    wsClient = new RuntimeWsClient({
      controlPlaneUrl: CONTROL_PLANE_WS_URL,
      authToken: RUNTIME_AUTH_TOKEN,
      slotId: parseInt(SLOT_ID, 10) || 0,
      tenantId: parseInt(TENANT_ID, 10) || 0,
      log,
      getPageState: () => g_state,
    });
    wsClient.start();
    log.info(
      { url: CONTROL_PLANE_WS_URL.replace(/token=[^&]+/, 'token=***') },
      'D8-1 · WS bridge to backend started (early init · before integrity-checks)',
    );
  } else {
    log.info('D8-1 · CONTROL_PLANE_WS_URL not set · running standalone (D6 test mode)');
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

  // D8-1 · 状态同步给 WS client (心跳里 backend 看的 pageState 实时反映)
  if (result.state === 'qr' || result.state === 'chat-list' || result.state === 'splash' || result.state === 'splash-stuck') {
    g_state = result.state;
  } else {
    g_state = 'unknown';
  }

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

  // ─── D6 · QR live server (host 浏览器看活 QR · 用手机扫真画布) ─
  if (result.state === 'qr' && process.env.QR_LIVE_SERVER !== 'false') {
    const port = Number(process.env.QR_LIVE_PORT ?? 9701);
    startQrLiveServer({ page, port, log });
  }

  // ─── D6 · 命中 qr 后长 poll 等 chat-list (等用户真扫码) ───────
  // C5/C6 验: 命中 chat-list 后 graceful shutdown · creds 落盘 · 二次 launch 期望
  // 直接进 chat-list (因为 user-data-dir 含 IndexedDB session)
  // 2026-04-25 · D7-1 · idle activity scheduler (Codex 拍板低强度 idle 行为)
  // 仅 chat-list 状态启 · 5-15min 间隔 · 默认动作: scroll + mouse + focus cycle
  // HUMAN_BEHAVIOR_ENABLED=false 完全禁用 (soak A/B 对照)
  let idleScheduler: IdleActivityScheduler | null = null;
  const startIdleSchedulerIfNeeded = (): void => {
    if (!SOAK_MODE) return;
    if (idleScheduler) return;
    idleScheduler = new IdleActivityScheduler({
      page,
      log,
      enabled: HUMAN_BEHAVIOR_ENABLED,
    });
    idleScheduler.start();
  };

  if (result.state === 'qr') {
    log.info('D6 · entering wait-for-login (long poll up to 10 min)');
    const loginResult = await waitForLogin({ page, diagnosticsDir, log });
    log.info(loginResult, 'D6 wait-for-login result');
    if (loginResult.outcome === 'chat-list') {
      // D8-1 · 状态同步: qr → chat-list
      g_state = 'chat-list';
      log.info(
        { soakMode: SOAK_MODE },
        'LOGIN SUCCESS · waiting 15s for Chromium to flush IndexedDB/Cookies',
      );
      // Chromium IndexedDB / Cookies 异步 flush · 太快 close 会丢 session
      // 实测: 不等的话 wa-data-test/profile 目录都不会创建 (D6 实测踩坑)
      await new Promise((r) => setTimeout(r, 15_000));

      // 主动触发 page.evaluate · 强制 IndexedDB tx 完成
      try {
        await page.evaluate(() => {
          // WA Web 把 session 存 'wawc_db' / 'model-storage' 等 IndexedDB
          // 等所有 transaction 完成 · 没直接 API · 用 storage estimate 触发 flush
          return navigator.storage?.estimate?.();
        });
      } catch {
        /* ignore */
      }

      if (SOAK_MODE) {
        // D7-1 · soak 模式不 close · 启 idle 调度器 · 等 24h
        log.info('D7-1 · SOAK_MODE=true · 不 close browser · 启 idle scheduler');
        startIdleSchedulerIfNeeded();
      } else {
        // D6 测模式 (默认) · graceful close 验 C5/C6
        log.info('D6 · graceful shutdown to persist session for C5/C6 verify');
        try {
          await browser.close();
        } catch (err) {
          log.warn({ err: err instanceof Error ? err.message : err }, 'browser.close after login failed');
        }
        log.info('D6 · runtime exit code=0 · 重启同 user-data-dir 应免扫码');
        process.exit(0);
      }
    }
  } else if (result.state === 'chat-list') {
    log.info('launched directly into chat-list · session restored from user-data-dir (C6 PASS)');
    // D7-1 · rehydrate 路径 · 直接进 idle scheduler (如开了 soak)
    startIdleSchedulerIfNeeded();
  }

  // ─── 占位心跳 (D4-5 替换为 WS) ────────────────────────────────
  setInterval(() => {
    log.info({ ts: Date.now(), state: result.state }, 'heartbeat (placeholder)');
  }, 30_000);

  // graceful shutdown
  const shutdown = async (signal: string) => {
    log.warn({ signal }, 'shutdown signal received');
    if (idleScheduler) {
      idleScheduler.stop();
    }
    if (wsClient) {
      await wsClient.stop();
    }
    try {
      await browser.close();
    } catch (err) {
      log.error({ err }, 'browser.close failed');
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  log.info(
    {
      soakMode: SOAK_MODE,
      humanBehavior: HUMAN_BEHAVIOR_ENABLED,
      wsBridge: !!wsClient,
    },
    'runtime ready · D8-1 WS bridge active when configured',
  );
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
