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
import { BindStateMachine, type BindState } from './bind-state-machine';
import type {
  RuntimeCommand,
  QrEvent,
  BindStateEvent,
  ConnectionOpenEvent,
  ConnectionCloseEvent,
  RuntimeErrorEvent,
} from '@wahubx/shared';

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

  // ─── D8-2 · bind 流程状态机 ─────────────────────────────────────
  // 严格单向 · idle → starting → qr → connecting → connected (Codex 锁)
  const fsm = new BindStateMachine(log);
  const slotIdNum = parseInt(SLOT_ID, 10) || 0;

  // ─── D7-1 · idle activity scheduler ──────────────────────────────
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

  // ─── D8-2 · 事件 emit helpers (WS 桥推 backend) ──────────────────
  // reason 是 transition 解释 (给 fsm log) · error 是真错信息 (只 failed/timeout/cancelled 才填)
  const emitBindState = (state: BindState, reason?: string, error?: string): void => {
    if (state === 'idle') return; // idle 不推 (内部状态)
    if (!fsm.tryTransition(state, reason ?? '')) return;
    if (!wsClient) return;
    // 只 failed/timeout/cancelled 才传 error 给 backend · 其他 state error=undefined
    const isErrorState = state === 'failed' || state === 'timeout' || state === 'cancelled';
    const evt: Omit<BindStateEvent, 'kind'> & { kind: 'event' } = {
      kind: 'event',
      type: 'bind-state',
      slotId: slotIdNum,
      ts: Date.now(),
      state: state as BindStateEvent['state'],
      error: isErrorState ? error ?? reason : undefined,
    };
    wsClient.emitEvent(evt as Parameters<typeof wsClient.emitEvent>[0]);
  };

  const emitQr = (dataUrl: string, refreshCount: number): void => {
    if (!wsClient) return;
    const evt: Omit<QrEvent, 'kind'> & { kind: 'event' } = {
      kind: 'event',
      type: 'qr',
      slotId: slotIdNum,
      ts: Date.now(),
      dataUrl,
      qrRefreshCount: refreshCount,
    };
    wsClient.emitEvent(evt as Parameters<typeof wsClient.emitEvent>[0]);
  };

  const emitConnectionOpen = (selector: string): void => {
    if (!wsClient) return;
    const evt: Omit<ConnectionOpenEvent, 'kind'> & { kind: 'event' } = {
      kind: 'event',
      type: 'connection-open',
      slotId: slotIdNum,
      ts: Date.now(),
      selector,
    };
    wsClient.emitEvent(evt as Parameters<typeof wsClient.emitEvent>[0]);
  };

  // 2026-04-25 · D8-3 · connection-close emit · 4 类 (Codex 锁定)
  // category: page-closed | browser-disconnected | wa-logged-out | runtime-fatal
  let connectionCloseEmitted = false; // 防多源重复推 (page close + browser disconnect 可能同时触发)
  const emitConnectionClose = (
    reason: string,
    category: 'page-closed' | 'browser-disconnected' | 'wa-logged-out' | 'runtime-fatal',
  ): void => {
    if (connectionCloseEmitted) return;
    connectionCloseEmitted = true;
    g_state = 'closed';
    log.warn({ reason, category }, 'D8-3 connection-close');
    if (!wsClient) return;
    const evt: Omit<ConnectionCloseEvent, 'kind'> & { kind: 'event' } = {
      kind: 'event',
      type: 'connection-close',
      slotId: slotIdNum,
      ts: Date.now(),
      reason,
      category,
    };
    wsClient.emitEvent(evt as Parameters<typeof wsClient.emitEvent>[0]);
  };

  // 2026-04-25 · D8-3 · runtime-error emit · 只转发 · 不 respawn (Codex 锁)
  const emitRuntimeError = (errorMsg: string, fatal: boolean): void => {
    log.error({ err: errorMsg, fatal }, 'D8-3 runtime-error');
    if (!wsClient) return;
    const evt: Omit<RuntimeErrorEvent, 'kind'> & { kind: 'event' } = {
      kind: 'event',
      type: 'runtime-error',
      slotId: slotIdNum,
      ts: Date.now(),
      error: errorMsg,
      fatal,
    };
    wsClient.emitEvent(evt as Parameters<typeof wsClient.emitEvent>[0]);
  };

  // ─── D8-3 · 挂 page/browser/process 关闭监听 ──────────────────────
  page.on('close', () => {
    emitConnectionClose('page closed (Chromium tab)', 'page-closed');
  });
  browser.on('disconnected', () => {
    emitConnectionClose('browser disconnected (Chromium 进程退)', 'browser-disconnected');
  });
  process.on('uncaughtException', (err) => {
    emitRuntimeError(`uncaughtException: ${err.message}`, true);
  });
  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    emitRuntimeError(`unhandledRejection: ${msg}`, false);
  });

  // 2026-04-25 · D8-3 · chat-list watchdog · 监 WA 主动踢号
  // 30s 周期 · chat-list 选择器消失 = WA logged out · 立刻推 connection-close
  // 仅 SOAK_MODE / always-on · 一次性绑测不启
  let chatListWatchdog: NodeJS.Timeout | null = null;
  let chatListMissCount = 0;
  const startChatListWatchdog = (): void => {
    if (chatListWatchdog) return;
    log.info('D8-3 chat-list watchdog STARTED · 30s 周期 · 检测 WA 踢号');
    chatListWatchdog = setInterval(() => {
      void (async () => {
        if (g_state !== 'chat-list') return; // 不在登录态不检
        try {
          // findFirstMatch 可能开销小 · 直接 page.$ 也行
          const res = await page.$('[data-testid="chat-list"], #pane-side');
          if (res) {
            await res.dispose();
            chatListMissCount = 0;
            return;
          }
          chatListMissCount += 1;
          log.warn({ chatListMissCount }, 'D8-3 chat-list watchdog · selector NOT found');
          // 连续 2 次 (60s) 没 = 真踢 · 不是临时 DOM 抖动
          if (chatListMissCount >= 2) {
            emitConnectionClose('chat-list selector missing 60s · WA likely logged us out', 'wa-logged-out');
            if (chatListWatchdog) clearInterval(chatListWatchdog);
            chatListWatchdog = null;
          }
        } catch (err) {
          log.warn({ err: err instanceof Error ? err.message : err }, 'chat-list watchdog tick failed');
        }
      })();
    }, 30_000);
  };

  // ─── D8-2 · 取消 controller (cancel-bind 触发) ───────────────────
  let bindAbortController: AbortController | null = null;
  let qrLiveServerStarted = false;

  // ─── D8-2 · 核心: 跑一轮 bind 流程 ──────────────────────────────
  // 共享给 WS 模式 (start-bind cmd) 和 standalone 模式 (auto-trigger)
  async function runBindFlow(): Promise<{
    outcome: 'connected' | 'timeout' | 'failed' | 'cancelled' | 'rehydrated';
    error?: string;
  }> {
    emitBindState('starting');
    bindAbortController = new AbortController();

    const detectResult = await loadWaWebAndDetect(page, diagnosticsDir, log);
    // D8-1 · 同步 g_state · WS 心跳即时反映
    if (
      detectResult.state === 'qr' ||
      detectResult.state === 'chat-list' ||
      detectResult.state === 'splash' ||
      detectResult.state === 'splash-stuck'
    ) {
      g_state = detectResult.state;
    } else {
      g_state = 'unknown';
    }
    log.info(
      {
        state: detectResult.state,
        selector: detectResult.selector,
        qrExtracted: !!detectResult.qrCanvasDataUrl,
      },
      'D8-2 wa-web load + state detect complete',
    );

    // ─── 直接 chat-list (rehydrate 路径) ──────────────────
    if (detectResult.state === 'chat-list') {
      log.info('rehydrate · launched directly into chat-list (no QR)');
      emitBindState('connecting', 'rehydrate · already chat-list');
      emitBindState('connected', 'rehydrate complete');
      emitConnectionOpen(detectResult.selector ?? '[data-testid="chat-list"]');
      startIdleSchedulerIfNeeded();
      return { outcome: 'rehydrated' };
    }

    // ─── 异常状态 · 直接失败 ──────────────────────────────
    if (detectResult.state !== 'qr') {
      const reason = `unexpected state: ${detectResult.state}`;
      emitBindState('failed', reason);
      return { outcome: 'failed', error: reason };
    }

    // ─── QR 状态 · 推首张 QR + 启 live server ──────────────
    emitBindState('qr', 'page entered qr state');
    if (detectResult.qrCanvasDataUrl) {
      const qrPath = path.join(diagnosticsDir, 'last-qr.dataurl.txt');
      fs.writeFileSync(qrPath, detectResult.qrCanvasDataUrl, 'utf-8');
      emitQr(detectResult.qrCanvasDataUrl, 0);
    }
    if (!qrLiveServerStarted && process.env.QR_LIVE_SERVER !== 'false') {
      const port = Number(process.env.QR_LIVE_PORT ?? 9701);
      startQrLiveServer({ page, port, log });
      qrLiveServerStarted = true;
    }

    // ─── 长 poll 等 chat-list (期间 QR refresh 推) ─────────
    const loginResult = await waitForLogin({
      page,
      diagnosticsDir,
      log,
      onQrRefresh: (dataUrl, refreshCount) => {
        emitQr(dataUrl, refreshCount);
      },
      cancelSignal: bindAbortController.signal,
    });
    log.info(loginResult, 'D8-2 wait-for-login result');

    if (loginResult.outcome === 'cancelled') {
      emitBindState('cancelled', 'cancel-bind from backend');
      return { outcome: 'cancelled' };
    }

    if (loginResult.outcome === 'timeout') {
      emitBindState('timeout', 'wait-for-login 10min timeout');
      return { outcome: 'timeout' };
    }

    if (loginResult.outcome === 'chat-list') {
      g_state = 'chat-list';
      emitBindState('connecting', 'chat-list selector matched · 15s flush');
      log.info('LOGIN SUCCESS · 15s flush for IndexedDB/Cookies');
      await new Promise((r) => setTimeout(r, 15_000));
      try {
        await page.evaluate(() => navigator.storage?.estimate?.());
      } catch {
        /* ignore */
      }
      emitBindState('connected', 'flush done · session locked');
      emitConnectionOpen(loginResult.chatListSelector ?? '[data-testid="chat-list"]');
      startIdleSchedulerIfNeeded();
      // 2026-04-25 · D8-3 · WA logged-out 监测 · 周期检查 chat-list 在不在
      // 真用户被踢: chat-list 消失 · 出现 unsupported / qr / loading splash · 任一都不是 chat-list
      // SOAK_MODE 下才启 (D6 一次性测不需要 · 跑完即关)
      if (SOAK_MODE) {
        startChatListWatchdog();
      }
      return { outcome: 'connected' };
    }

    emitBindState('failed', loginResult.error ?? 'unknown');
    return { outcome: 'failed', error: loginResult.error };
  }

  // ─── D8-2 · WS 命令 handler (WS 模式才生效) ─────────────────────
  if (wsClient) {
    let runningPromise: Promise<unknown> | null = null;
    wsClient.setOnCommand(async (cmd: RuntimeCommand) => {
      log.info({ type: cmd.type, requestId: cmd.requestId }, 'D8-2 cmd received');
      if (cmd.type === 'init') {
        // D8-2: init 是空操作 · runtime 已自带 env 配置
        // D9+ 可让 backend 通过 init 推 fingerprint / locale 覆盖 env
        return { ok: true, data: { initialized: true, slotId: slotIdNum } };
      }
      if (cmd.type === 'start-bind') {
        if (fsm.isInProgress()) {
          return { ok: false, error: `bind already in progress · current=${fsm.state}` };
        }
        fsm.resetIfTerminal();
        // 异步启动 · 立即 ACK · 流程通过事件流回报
        runningPromise = runBindFlow()
          .then((r) => {
            log.info({ outcome: r.outcome, error: r.error }, 'D8-2 runBindFlow ended');
            // terminal state 让 fsm 准备下一轮
            fsm.resetIfTerminal();
            runningPromise = null;
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            log.error({ err: msg }, 'runBindFlow threw');
            emitBindState('failed', msg);
            fsm.resetIfTerminal();
            runningPromise = null;
          });
        return { ok: true, data: { state: 'starting' } };
      }
      if (cmd.type === 'cancel-bind') {
        if (!fsm.isInProgress()) {
          return { ok: false, error: 'no bind in progress' };
        }
        bindAbortController?.abort();
        return { ok: true, data: { wasInState: fsm.state } };
      }
      if (cmd.type === 'fetch-status') {
        return {
          ok: true,
          data: {
            state: fsm.state,
            sessionStartedAt: fsm.sessionStartedAt,
            pageState: g_state,
          },
        };
      }
      if (cmd.type === 'shutdown') {
        // 优雅关 · 不立刻死 · 等 ACK 发出去再退
        setTimeout(() => void shutdown('cmd-shutdown'), 200);
        return { ok: true, data: { willShutdown: true } };
      }
      // send-text / send-media · D10 W2 实装 · 现 stub
      return { ok: false, error: `cmd type "${cmd.type}" not implemented in D8-2 (W2 work)` };
    });
    log.info('D8-2 · WS command handlers registered (init/start-bind/cancel-bind/fetch-status/shutdown)');
  }

  // ─── 启动行为分流 ───────────────────────────────────────────────
  if (wsClient) {
    // WS 模式 · 等 backend 发 start-bind · 不自动跑
    log.info('D8-2 · WS mode · waiting for start-bind command from backend');
  } else {
    // standalone 模式 (D6 backward compat) · 自动跑一轮 + close
    log.info('D8-2 · standalone mode · auto-trigger runBindFlow (D6 path)');
    void runBindFlow().then(async (r) => {
      log.info({ outcome: r.outcome }, 'standalone runBindFlow ended');
      if (r.outcome === 'connected' || r.outcome === 'rehydrated') {
        if (!SOAK_MODE) {
          log.info('D6 standalone · no SOAK · graceful close + exit');
          try {
            await browser.close();
          } catch {
            /* ignore */
          }
          process.exit(0);
        }
      }
    });
  }

  // ─── graceful shutdown ───────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    log.warn({ signal, fsmState: fsm.state }, 'shutdown signal received');
    if (idleScheduler) idleScheduler.stop();
    if (wsClient) await wsClient.stop();
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
      fsmState: fsm.state,
    },
    'runtime ready · D8-2 bind 主链路 (WS or standalone)',
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
