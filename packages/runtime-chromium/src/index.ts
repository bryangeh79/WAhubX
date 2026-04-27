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
import { HumanBehaviorSimulator } from './human-behavior';
import {
  openChatByPhone,
  sendTextInOpenChat,
  sendMediaInOpenChat,
} from './wa-web/actions';
import { installInboundWatcher } from './wa-web/inbound-watcher';
import { enterChat, readLatestMessages, exitChat, type HighFidelityMessage } from './wa-web/chat-reader';
// 2026-04-26 · D11 · WA Status / Profile actions
import { postStatusText, postStatusMedia, browseStatuses, reactStatuses } from './wa-web/status';
import { updateAbout } from './wa-web/profile';
import type {
  RuntimeCommand,
  QrEvent,
  BindStateEvent,
  ConnectionOpenEvent,
  ConnectionCloseEvent,
  RuntimeErrorEvent,
} from '@wahubx/shared';
import { resolveRuntimeLaunchConfigFromEnv } from '@wahubx/shared';

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
  // 2026-04-25 · D12-1 · 统一启动配置抽象 (Codex 锁定 6 边界)
  // 单一来源 RuntimeLaunchConfig · 替代散落 env 读 · backend / runtime 共用同一份 resolver
  // D12-1 阶段先 log · D12-2 进程管理才真接管业务流
  const cfg = resolveRuntimeLaunchConfigFromEnv();
  log.info(
    {
      os: cfg.os,
      slotId: cfg.slotId,
      slotIndex: cfg.slotIndex,
      tenantId: cfg.tenantId,
      dataDir: cfg.dataDir,
      profileDir: cfg.profileDir,
      diagnosticsDir: cfg.diagnosticsDir,
      chromiumExecutablePath: cfg.chromiumExecutablePath,
      chromiumExecutableExists: cfg.chromiumExecutableExists,
      hasProxy: !!cfg.proxyUrl,
      proxyCountry: cfg.proxyCountry,
      dnsStrategy: cfg.dnsStrategy,
      soakMode: cfg.soakMode,
      humanBehaviorEnabled: cfg.humanBehaviorEnabled,
      hasWsBridge: !!cfg.controlPlaneWsUrl,
      qrLiveServerEnabled: cfg.qrLiveServerEnabled,
      warningCount: cfg.warnings.length,
    },
    'D12-1 RuntimeLaunchConfig resolved',
  );
  if (cfg.warnings.length > 0) {
    for (const w of cfg.warnings) {
      log.warn({ source: 'D12-1' }, w);
    }
  }
  if (!cfg.chromiumExecutableExists) {
    log.error(
      { chromiumPath: cfg.chromiumExecutablePath },
      'D12-1 · chromium 可执行文件不存在 · puppeteer.launch 必失败 · 显式 PUPPETEER_EXECUTABLE_PATH 修复',
    );
    // 不立刻 exit · 保留 D6 测路径行为 · 让下游 puppeteer 抛真错误
  }

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

  // 2026-04-26 · P0.10 · CS slot 用 headed (有桌面窗口) · 让 bringToFront 真生效
  // RUNTIME_HEADED env 由 backend buildChildEnv 按 slot.role 设
  // CS (always-on · 操作员人工接管) → headed
  // broadcast (批跑 · 无人值守) → headless 节省资源
  const headed = process.env.RUNTIME_HEADED === 'true';
  log.info({ launchArgs, userDataDir: profileDir, headed }, 'launching chromium');

  const browser = await puppeteer.launch({
    executablePath: PUPPETEER_EXECUTABLE_PATH,
    headless: !headed,
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
    stopHeartbeatKeepalive();
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

  // 2026-04-25 · D10 · inbound watcher · 监听新消息推 message-upsert event
  // 2026-04-26 · P0.11 · onIncoming 不再直接 emit hint · 改塞 candidate queue · worker 进 chat 拿真消息
  let inboundUninstall: (() => Promise<void>) | null = null;

  // P0.11 · candidate queue + worker · 串行进 chat 读真消息
  // dedupe by waMessageId (60s 窗口) · 防同消息多次入库
  const candidateQueue: Array<{
    rowDataId: string;
    fallbackHint: unknown; // 老 hint · chat-reader 失败时退化用
    enqueuedAt: number;
  }> = [];
  const recentSeenMessageIds = new Map<string, number>(); // wa_message_id → ts
  let chatReaderBusy = false;
  // 节流: 同 chat 30s 内只进 1 次 (dedupe row data-id)
  const recentEnteredChats = new Map<string, number>();

  const drainCandidateQueue = async (): Promise<void> => {
    if (chatReaderBusy) return;
    chatReaderBusy = true;
    try {
      while (candidateQueue.length > 0) {
        const cand = candidateQueue.shift()!;
        // 节流检查: 同 chat 30s 内 skip
        const lastEnter = recentEnteredChats.get(cand.rowDataId) ?? 0;
        if (Date.now() - lastEnter < 30_000) {
          log.debug?.({ rowDataId: cand.rowDataId }, 'P0.11 同 chat 30s 内 skip');
          continue;
        }
        recentEnteredChats.set(cand.rowDataId, Date.now());

        // P0.11-4 · 接管中的 chat 跳过 (避免 puppeteer 抢操作员的鼠标)
        // 简化: 跳过判断 · 用 page.evaluate 看 chat-list row 是否当前被打开 (但不够精准)
        // 实际方案: 通过 backend 查 takeover-lock · 但这要 cmd 双向 · 暂留 P0.11-4 完整版
        // 先粗暴: P0.11-3 阶段直接进 · P0.11-4 再加 backend 互斥查询

        // 进 chat
        const enter = await enterChat(page, cand.rowDataId, log);
        if (!enter.ok) {
          log.warn(
            { rowDataId: cand.rowDataId, err: enter.error },
            'P0.11 enterChat 失败 · fallback 用老 hint emit (低保真)',
          );
          // fallback: emit 老 hint (保留兼容)
          if (wsClient) {
            wsClient.emitEvent({
              kind: 'event',
              type: 'message-upsert',
              slotId: slotIdNum,
              ts: Date.now(),
              messages: [cand.fallbackHint],
            } as Parameters<typeof wsClient.emitEvent>[0]);
          }
          continue;
        }
        // 读真消息
        let messages: HighFidelityMessage[] = [];
        try {
          messages = await readLatestMessages(page, log, { count: 5 });
        } catch (err) {
          log.warn({ err: err instanceof Error ? err.message : err }, 'P0.11 readLatestMessages 失败');
        }
        // dedupe 已见过的 messageId
        const fresh = messages.filter((m) => {
          const seen = recentSeenMessageIds.get(m.waMessageId);
          if (seen && Date.now() - seen < 60_000) return false;
          recentSeenMessageIds.set(m.waMessageId, Date.now());
          return true;
        });
        // GC seen map
        if (recentSeenMessageIds.size > 500) {
          const cutoff = Date.now() - 5 * 60_000;
          for (const [k, t] of recentSeenMessageIds.entries()) {
            if (t < cutoff) recentSeenMessageIds.delete(k);
          }
        }
        // 退 chat
        await exitChat(page, log);

        // emit 真消息 (即使空也 emit · 让 backend 知道处理过)
        if (fresh.length > 0 && wsClient) {
          // 加 schemaVersion 让 backend 区分老 hint vs 高保真
          const payload = fresh.map((m) => ({ ...m, schemaVersion: 'p0.11-hifi' }));
          wsClient.emitEvent({
            kind: 'event',
            type: 'message-upsert',
            slotId: slotIdNum,
            ts: Date.now(),
            messages: payload as unknown[],
          } as Parameters<typeof wsClient.emitEvent>[0]);
          log.info({ count: fresh.length, rowDataId: cand.rowDataId }, 'P0.11 emit 高保真 messages');
        }
      }
    } finally {
      chatReaderBusy = false;
    }
  };

  const installInboundWatcherIfNeeded = async (): Promise<void> => {
    if (inboundUninstall) return; // 已装
    try {
      const { uninstall } = await installInboundWatcher(page, {
        log,
        onIncoming: (hint) => {
          // P0.11 · 不再直接 emit · 改塞 queue · worker 进 chat 拿真消息
          if (!wsClient) return;
          const h = hint as { rowDataId?: string | null };
          if (h.rowDataId) {
            candidateQueue.push({
              rowDataId: h.rowDataId,
              fallbackHint: hint,
              enqueuedAt: Date.now(),
            });
            void drainCandidateQueue();
          } else {
            // 没 rowDataId · 直接走老 hint emit fallback
            wsClient.emitEvent({
              kind: 'event',
              type: 'message-upsert',
              slotId: slotIdNum,
              ts: Date.now(),
              messages: [hint as unknown],
            } as Parameters<typeof wsClient.emitEvent>[0]);
          }
        },
      });
      inboundUninstall = uninstall;
      log.info('D10 inbound watcher installed · P0.11 高保真 enabled');
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : err },
        'D10 inbound watcher install failed · 不阻塞 · receive 暂不可用',
      );
    }
  };

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

  // ─── 2026-04-28 · C2 · heartbeat keep-alive · 防 WA idle-purge ─────
  // 每 60s 触发一次 chat-list scroll · WA Web 重发 presence 订阅 · 服务端看到流量
  // 每 5min 触发一次 page.evaluate · 强制刷新一次 active chat (无副作用)
  // 配合 chat-list watchdog · 共同维持 always-on 心跳
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let heartbeatTickCount = 0;
  const startHeartbeatKeepalive = (): void => {
    if (heartbeatTimer) return;
    log.info('C2 heartbeat keep-alive STARTED · 60s scroll + 5min refresh · 绕过 idle-purge');
    heartbeatTimer = setInterval(() => {
      void (async () => {
        if (g_state !== 'chat-list') return;
        heartbeatTickCount += 1;
        try {
          await page.evaluate(() => {
            const pane = document.querySelector('#pane-side');
            if (pane) {
              pane.scrollTop += 1;
              setTimeout(() => {
                pane.scrollTop = Math.max(0, pane.scrollTop - 1);
              }, 50);
            }
          });
          if (heartbeatTickCount % 5 === 0) {
            await page.evaluate(() => {
              window.dispatchEvent(new Event('focus'));
              document.dispatchEvent(new Event('visibilitychange'));
            });
            log.debug({ heartbeatTickCount }, 'C2 heartbeat · 5min focus/visibility refresh');
          }
        } catch (err) {
          log.warn({ err: err instanceof Error ? err.message : err }, 'C2 heartbeat tick failed');
        }
      })();
    }, 60_000);
  };
  const stopHeartbeatKeepalive = (): void => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      log.info('C2 heartbeat keep-alive STOPPED');
    }
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
      void installInboundWatcherIfNeeded();
      // 2026-04-25 · P1.5 · 普通模式也启 watchdog · 用户测试期间也要能看到 WA 踢号
      // (老逻辑只在 SOAK_MODE · 单次绑测 / T2.x 必无掉线感知)
      startChatListWatchdog();
      startHeartbeatKeepalive();
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
      void installInboundWatcherIfNeeded();
      // 2026-04-25 · D8-3 · WA logged-out 监测 · 周期检查 chat-list 在不在
      // 真用户被踢: chat-list 消失 · 出现 unsupported / qr / loading splash · 任一都不是 chat-list
      // 2026-04-25 · P1.5 · 解除 SOAK_MODE 门槛 · 普通模式也启 · 让用户看到 "号被踢"
      startChatListWatchdog();
      startHeartbeatKeepalive();
      return { outcome: 'connected' };
    }

    emitBindState('failed', loginResult.error ?? 'unknown');
    return { outcome: 'failed', error: loginResult.error };
  }

  // ─── D8-2 · WS 命令 handler (WS 模式才生效) ─────────────────────

  // 2026-04-25 · P0.5 + P0.6 · 合并实现 · per-slot send-* 串行 + 全链路硬超时
  //
  // 关键 (上轮经验):
  //   1. mutex 只能在 inner promise 真 settle 后才释放 · 否则 hard-timeout 返 fail 后 inner 在背景跑
  //      跟下一个 cmd 在 page 上互殴 → render crash
  //   2. hard-timeout 提早返调用方 (let backend 拿到 ack) · 但 mutex 保持锁 · 等 inner settle 再放
  //   3. inner settle 等待也加 cap (90s) · 防真 hung 卡死所有后续 cmd
  //
  // 范围: send-text / send-media · 同 slot 内串行 · 进程内 (runtime per-slot 一个 process)

  let sendMutex: Promise<void> = Promise.resolve();
  const SEND_HARD_TIMEOUT_MS = 25_000;
  const SEND_INNER_SETTLE_MAX_MS = 90_000; // inner truly hung 时 mutex 等多久强放

  const withSendMutexAndHardTimeout = async <T extends { ok: boolean; error?: string }>(
    label: string,
    inner: () => Promise<T>,
    failResult: () => T,
  ): Promise<T> => {
    // ── 排队 ────────────────────────────
    const prev = sendMutex;
    let release: () => void = () => {};
    sendMutex = new Promise<void>((res) => {
      release = res;
    });
    const waitedSince = Date.now();
    await prev.catch(() => {});
    const queueWaitMs = Date.now() - waitedSince;
    if (queueWaitMs > 100) {
      log.info({ label, queueWaitMs }, 'P0.6 mutex · 排队等到 · 进 page');
    }

    // ── 启动 inner + 硬超时 race ────────
    const innerP: Promise<T> = inner().catch((err): T => {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn({ label, err: msg }, 'P0.5 inner 抛异常 · 转为 ok=false');
      return { ok: false, error: `${label} threw: ${msg}` } as T;
    });
    let raceResolved = false;
    let timer: NodeJS.Timeout | null = null;

    const timeoutSignal = new Promise<{ kind: 'timeout' }>((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'timeout' }), SEND_HARD_TIMEOUT_MS);
    });
    const innerSignal = innerP.then((r) => ({ kind: 'inner' as const, result: r }));

    const winner = await Promise.race([innerSignal, timeoutSignal]);
    if (timer) clearTimeout(timer);

    if (winner.kind === 'inner') {
      raceResolved = true;
      release();
      return winner.result;
    }

    // ── 硬超时分支 ───────────────────────
    log.error(
      { label, timeoutMs: SEND_HARD_TIMEOUT_MS },
      `P0.5 全链路硬超时 (${label.toUpperCase().replace(/-/g, '_')}_TIMEOUT) · 调用方先收 fail · mutex 等 inner settle 再放 (max ${SEND_INNER_SETTLE_MAX_MS}ms)`,
    );
    // page 恢复 · 不阻塞 · Escape 关 modal · stop 拦载入
    void (async () => {
      try {
        await page.keyboard.press('Escape').catch(() => {});
      } catch {
        /* ignore */
      }
      try {
        await page.evaluate(() => (window as Window).stop?.()).catch(() => {});
      } catch {
        /* ignore */
      }
    })();

    // ── 关键: mutex 不立即放 · 等 inner settle (有 cap) 再放 ──
    // 这一步异步跑 · 不阻塞调用方拿到 fail
    void (async () => {
      try {
        await Promise.race([
          innerP.then(
            (r) => {
              if (!raceResolved) {
                log.warn(
                  { label, succeededAfterTimeout: r.ok, error: r.error },
                  'P0.5 inner 在硬超时后 settle · mutex 释放',
                );
              }
            },
            () => {},
          ),
          new Promise<void>((res) => setTimeout(res, SEND_INNER_SETTLE_MAX_MS)),
        ]);
      } finally {
        release();
      }
    })();

    return failResult();
  };

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
        // 2026-04-25 · P0.4 · 上轮 abortController 清掉 · 防止"上次取消信号"穿越本轮
        bindAbortController = null;
        // 异步启动 · 立即 ACK · 流程通过事件流回报
        runningPromise = runBindFlow()
          .then((r) => {
            log.info({ outcome: r.outcome, error: r.error }, 'D8-2 runBindFlow ended');
            // terminal state 让 fsm 准备下一轮
            fsm.resetIfTerminal();
            runningPromise = null;
            // P0.4 · 本轮结束 · 清 controller (任何 outcome)
            bindAbortController = null;
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            log.error({ err: msg }, 'runBindFlow threw');
            emitBindState('failed', msg);
            fsm.resetIfTerminal();
            runningPromise = null;
            bindAbortController = null;
          });
        return { ok: true, data: { state: 'starting' } };
      }
      if (cmd.type === 'cancel-bind') {
        if (!fsm.isInProgress()) {
          // 2026-04-25 · P0.3 · 没在跑也不抛 · 业务层视作幂等返
          return { ok: true, data: { wasInState: fsm.state, noop: true } };
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
      // 2026-04-25 · 测试冻结期 · fetch-account-info · 读 WA Web page 上的真 phone/JID
      if (cmd.type === 'fetch-account-info') {
        if (g_state !== 'chat-list') {
          return { ok: false, error: `not in chat-list (current: ${g_state})` };
        }
        try {
          const info = await page.evaluate(() => {
            // 多策略读 phone
            const result: { phone: string | null; source: string; rawWid?: string } = {
              phone: null,
              source: 'none',
            };
            // WA wid 格式: <phone>:<deviceId>@<server>
            // 例: "60186888168:9@c.us" · phone=60186888168 · device=9 · server=c.us
            // device 部分可能没 (主设备 wid 无 :)
            const WID_RE = /(\d{8,15})(?::\d+)?@(c\.us|s\.whatsapp\.net|lid)/;
            // 策略 1: localStorage 'last-wid' (modern WA Web)
            try {
              const lastWid = localStorage.getItem('last-wid') || localStorage.getItem('last-wid-md');
              if (lastWid) {
                result.rawWid = lastWid;
                const cleaned = lastWid.replace(/^"|"$/g, '');
                const m = cleaned.match(WID_RE);
                if (m) {
                  result.phone = m[1];
                  result.source = 'last-wid';
                  return result;
                }
              }
            } catch {
              /* ignore */
            }
            // 策略 2: 扫所有 localStorage key · 找含 phone-like 数字 + @c.us/@s.whatsapp.net
            try {
              for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k) continue;
                const v = localStorage.getItem(k) || '';
                const m = v.match(WID_RE);
                if (m) {
                  result.phone = m[1];
                  result.source = `localStorage:${k}`;
                  result.rawWid = m[0];
                  return result;
                }
              }
            } catch {
              /* ignore */
            }
            return result;
          });
          log.info(info, 'D-fetch-account-info result');
          return { ok: true, data: info };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      // 2026-04-26 · P0.10++ · CDP screencast 嵌入 5173
      if (cmd.type === 'start-screencast') {
        try {
          const cdp = await page.target().createCDPSession();
          // attach frame ack handler
          cdp.on('Page.screencastFrame', async (params: {
            data: string;
            metadata: { offsetTop: number; pageScaleFactor: number; deviceWidth: number; deviceHeight: number; scrollOffsetX: number; scrollOffsetY: number; timestamp: number };
            sessionId: number;
          }) => {
            // emit frame
            if (wsClient) {
              wsClient.emitEvent({
                kind: 'event',
                type: 'screencast-frame',
                slotId: slotIdNum,
                ts: Date.now(),
                data: params.data,
                mime: 'image/jpeg',
                width: params.metadata.deviceWidth,
                height: params.metadata.deviceHeight,
                sessionId: params.sessionId,
              } as Parameters<typeof wsClient.emitEvent>[0]);
            }
            // ack frame · 让 CDP 继续推
            try {
              await cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId });
            } catch {
              /* CDP closed · 静默 */
            }
          });
          // 2026-04-26 · P0.10++ fix 模糊
          //   quality 60 → 85 · maxW/H 1024×768 → 1280×800 (= defaultViewport · 1:1 不缩)
          //   maxWidth 0 表示不缩 · 用 chromium viewport 自然尺寸
          await cdp.send('Page.startScreencast', {
            format: 'jpeg',
            quality: cmd.quality ?? 85,
            maxWidth: cmd.maxWidth ?? 1280,
            maxHeight: cmd.maxHeight ?? 800,
            everyNthFrame: 1,
          });
          // 存 cdp 供 stop 用
          (globalThis as { __screencastCdp?: unknown }).__screencastCdp = cdp;
          log.info('P0.10++ Page.startScreencast 已启');
          return { ok: true, data: { started: true } };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error({ err: msg }, 'P0.10++ start-screencast 失败');
          return { ok: false, error: msg };
        }
      }
      if (cmd.type === 'stop-screencast') {
        try {
          const cdp = (globalThis as { __screencastCdp?: { send: (m: string) => Promise<unknown>; detach: () => Promise<void> } }).__screencastCdp;
          if (cdp) {
            await cdp.send('Page.stopScreencast').catch(() => {});
            await cdp.detach().catch(() => {});
            (globalThis as { __screencastCdp?: unknown }).__screencastCdp = undefined;
          }
          log.info('P0.10++ stop-screencast 已停');
          return { ok: true, data: { stopped: true } };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      if (cmd.type === 'screencast-input') {
        try {
          const cdp = (globalThis as { __screencastCdp?: { send: (m: string, p?: unknown) => Promise<unknown> } }).__screencastCdp;
          if (!cdp) return { ok: false, error: 'screencast not started' };
          const e = cmd.event;
          if (e.kind === 'mouse') {
            await cdp.send('Input.dispatchMouseEvent', {
              type: e.type,
              x: e.x,
              y: e.y,
              button: e.button ?? 'left',
              deltaX: e.deltaX ?? 0,
              deltaY: e.deltaY ?? 0,
              clickCount: e.clickCount ?? 1,
            });
          } else if (e.kind === 'key') {
            await cdp.send('Input.dispatchKeyEvent', {
              type: e.type,
              text: e.text,
              key: e.key,
              code: e.code,
              modifiers: e.modifiers ?? 0,
            });
          }
          return { ok: true, data: { dispatched: true } };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      // 2026-04-26 · P0.10 · 人工接管入口 · 把 Chromium page 提到桌面前台
      if (cmd.type === 'bring-to-front') {
        try {
          await page.bringToFront();
          log.info('P0.10 page.bringToFront · 接管窗口已提前台');
          return { ok: true, data: { broughtToFront: true } };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn({ err: msg }, 'P0.10 bringToFront 失败');
          return { ok: false, error: `bringToFront failed: ${msg}` };
        }
      }
      if (cmd.type === 'shutdown') {
        // 优雅关 · 不立刻死 · 等 ACK 发出去再退
        setTimeout(() => void shutdown('cmd-shutdown'), 200);
        return { ok: true, data: { willShutdown: true } };
      }
      // 2026-04-25 · D10 W2 · sendText 实装
      // 2026-04-25 · P0.5/P0.6 · 包 mutex+硬超时 · 调用方 25s 拿 fail · 但 inner 跑完才放 mutex
      if (cmd.type === 'send-text') {
        return withSendMutexAndHardTimeout(
          'send-text',
          async () => {
            if (g_state !== 'chat-list') {
              return { ok: false, error: `cannot send · not in chat-list (current: ${g_state})` };
            }
            const openR = await openChatByPhone(page, cmd.to, log, diagnosticsDir);
            if (!openR.ok) {
              return { ok: false, error: `open chat failed: ${openR.error}` };
            }
            const sim = new HumanBehaviorSimulator(page);
            const sendR = await sendTextInOpenChat(page, cmd.text, log, {
              simulator: sim,
              diagnosticsDir,
            });
            if (!sendR.ok) return { ok: false, error: sendR.error };
            return { ok: true, data: { messageId: sendR.pseudoMessageId } };
          },
          () => ({
            ok: false,
            error: `SEND_TEXT_TIMEOUT (entire send-text flow > ${SEND_HARD_TIMEOUT_MS}ms · runtime 强制 abort)`,
          }),
        );
      }
      // 2026-04-25 · D10 W2 · sendMedia 实装 (image/file)
      if (cmd.type === 'send-media') {
        return withSendMutexAndHardTimeout(
          'send-media',
          async () => {
            if (g_state !== 'chat-list') {
              return { ok: false, error: `cannot send · not in chat-list (current: ${g_state})` };
            }
            // 2026-04-28 · B1+B2 · video 走 image 通道 (WA Web image input 接受 video MIME)
            //   voice/audio 走 file 通道 (WA Web document upload · WA 自动识别 audio)
            const supported =
              cmd.mediaType === 'image' ||
              cmd.mediaType === 'file' ||
              cmd.mediaType === 'video' ||
              cmd.mediaType === 'voice' ||
              cmd.mediaType === 'audio';
            if (!supported) {
              return {
                ok: false,
                error: `unsupported mediaType: ${cmd.mediaType}`,
              };
            }
            const openR = await openChatByPhone(page, cmd.to, log, diagnosticsDir);
            if (!openR.ok) {
              return { ok: false, error: `open chat failed: ${openR.error}` };
            }
            const uploadKind: 'image' | 'file' =
              cmd.mediaType === 'image' || cmd.mediaType === 'video' ? 'image' : 'file';
            const sendR = await sendMediaInOpenChat(
              page,
              cmd.mediaBase64,
              {
                caption: cmd.caption,
                fileName: cmd.fileName,
                kind: uploadKind,
                diagnosticsDir,
              },
              log,
            );
            if (!sendR.ok) return { ok: false, error: sendR.error };
            return { ok: true, data: { messageId: sendR.pseudoMessageId } };
          },
          () => ({
            ok: false,
            error: `SEND_MEDIA_TIMEOUT (entire send-media flow > ${SEND_HARD_TIMEOUT_MS}ms · runtime 强制 abort)`,
          }),
        );
      }
      // 2026-04-26 · D11 · post-status-text · 发文字 status
      if (cmd.type === 'post-status-text') {
        return withSendMutexAndHardTimeout(
          'post-status-text',
          async () => {
            if (g_state !== 'chat-list') {
              return { ok: false, error: `cannot post status · not in chat-list (current: ${g_state})` };
            }
            const r = await postStatusText(page, cmd.text, log, diagnosticsDir);
            if (!r.ok) return { ok: false, error: r.error };
            return { ok: true, data: { messageId: r.pseudoMessageId } };
          },
          () => ({ ok: false, error: `POST_STATUS_TEXT_TIMEOUT (>${SEND_HARD_TIMEOUT_MS}ms · runtime abort)` }),
        );
      }
      // 2026-04-26 · D11 · post-status-media · 发图/视频 status
      if (cmd.type === 'post-status-media') {
        return withSendMutexAndHardTimeout(
          'post-status-media',
          async () => {
            if (g_state !== 'chat-list') {
              return { ok: false, error: `cannot post status media · not in chat-list (current: ${g_state})` };
            }
            const r = await postStatusMedia(
              page,
              cmd.mediaBase64,
              cmd.mediaType,
              { caption: cmd.caption, fileName: cmd.fileName, diagnosticsDir },
              log,
            );
            if (!r.ok) return { ok: false, error: r.error };
            return { ok: true, data: { messageId: r.pseudoMessageId } };
          },
          () => ({ ok: false, error: `POST_STATUS_MEDIA_TIMEOUT (>${SEND_HARD_TIMEOUT_MS}ms · runtime abort)` }),
        );
      }
      // 2026-04-26 · D11 · browse-statuses · 浏览未读他人 status
      if (cmd.type === 'browse-statuses') {
        return withSendMutexAndHardTimeout(
          'browse-statuses',
          async () => {
            if (g_state !== 'chat-list') {
              return { ok: false, error: `cannot browse status · not in chat-list (current: ${g_state})` };
            }
            const r = await browseStatuses(
              page,
              { maxItems: cmd.maxItems, dwellMs: cmd.dwellMs, diagnosticsDir },
              log,
            );
            if (!r.ok) return { ok: false, error: r.error };
            return { ok: true, data: { viewed: r.viewed } };
          },
          () => ({ ok: false, error: `BROWSE_STATUSES_TIMEOUT (>${SEND_HARD_TIMEOUT_MS}ms · runtime abort)` }),
        );
      }
      // 2026-04-26 · D11 · react-status · 给 N 条 status 点赞
      if (cmd.type === 'react-status') {
        return withSendMutexAndHardTimeout(
          'react-status',
          async () => {
            if (g_state !== 'chat-list') {
              return { ok: false, error: `cannot react status · not in chat-list (current: ${g_state})` };
            }
            const r = await reactStatuses(
              page,
              { maxItems: cmd.maxItems, emoji: cmd.emoji, diagnosticsDir },
              log,
            );
            if (!r.ok) return { ok: false, error: r.error };
            return { ok: true, data: { reacted: r.reacted } };
          },
          () => ({ ok: false, error: `REACT_STATUS_TIMEOUT (>${SEND_HARD_TIMEOUT_MS}ms · runtime abort)` }),
        );
      }
      // 2026-04-26 · D11 · update-profile-about · 改个人签名
      if (cmd.type === 'update-profile-about') {
        return withSendMutexAndHardTimeout(
          'update-profile-about',
          async () => {
            if (g_state !== 'chat-list') {
              return { ok: false, error: `cannot update profile · not in chat-list (current: ${g_state})` };
            }
            const r = await updateAbout(page, cmd.text, log, diagnosticsDir);
            if (!r.ok) return { ok: false, error: r.error };
            return { ok: true };
          },
          () => ({ ok: false, error: `UPDATE_PROFILE_TIMEOUT (>${SEND_HARD_TIMEOUT_MS}ms · runtime abort)` }),
        );
      }
      // 所有合法分支都覆盖 · 这里仅防御性兜底
      return { ok: false, error: `cmd type "${(cmd as { type?: string }).type ?? 'unknown'}" not implemented` };
    });
    log.info('D11 · WS command handlers registered (incl. post-status-text/media · browse-statuses · react-status · update-profile-about)');
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
    if (inboundUninstall) {
      try {
        await inboundUninstall();
      } catch {
        /* ignore */
      }
    }
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
