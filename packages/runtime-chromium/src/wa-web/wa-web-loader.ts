// 2026-04-25 · WA Web 加载 + QR/chat-list 状态识别
//
// D2 锁定范围:
//   - 加载 https://web.whatsapp.com (替代 about:blank)
//   - 等到出现 qr 或 chat-list (其他状态先不识别)
//   - 每个阶段截 screenshot 证据
//   - QR 提取做"原始值输出" · 不接 WS 协议
//
// 不在 D2 范围:
//   - bind 流自动化 (D4-5)
//   - send_text / send_media (W2)
//   - 多状态机 (P3)

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Page } from 'puppeteer-core';
import type { Logger } from 'pino';
import { findFirstMatch, WA_SELECTORS, SPLASH_STUCK_THRESHOLD_MS } from './wa-web-selectors';
import { captureEvidence, type EvidenceShot } from './screenshot-evidence';
import { createNavTimingsTracker, type NavTimings } from './nav-timing';
import { runDomForensics, type DomForensicsReport } from './dom-forensics';
import { captureAntiBotSignals, type AntiBotSignals } from './anti-bot-signals';

// D4: 5 态 (锁定 · 不再扩)
export type WaWebState = 'qr' | 'chat-list' | 'splash' | 'splash-stuck' | 'unknown';

export interface WaWebLoadResult {
  state: WaWebState;
  detectedAt: number;
  selector: string | null;
  qrCanvasDataUrl: string | null;
  evidence: EvidenceShot[];
  timings: NavTimings;
  forensics: DomForensicsReport | null;       // D4 · 法医分析
  antiBotSignals: AntiBotSignals | null;       // D4 · 反爬可见性
  unsupportedDetected: boolean;                // D4 · landing 降级页 detect
}

const WA_WEB_URL = 'https://web.whatsapp.com';
const NAV_TIMEOUT_MS = 60_000; // goto · WA Web 首屏可能 30+ s
// state 探测窗口 · 90s 给慢代理留余地 (实测 proxy 6 + iptables 53 封死下 splash 渲完 60+s)
// 过短会误判 unknown · 过长拖测试. 90s 是经验值 · soak 时再调.
const STATE_DETECT_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 1_000;

/**
 * 加载 WA Web · 等到 qr 或 chat-list
 * 全过程留 3 张证据: 加载前 · 加载后 · 状态识别后
 */
export async function loadWaWebAndDetect(
  page: Page,
  diagnosticsDir: string,
  log: Logger,
): Promise<WaWebLoadResult> {
  const evidence: EvidenceShot[] = [];

  // ─── Evidence #1 · launch 后空白页 (about:blank) ────────────
  const ev1 = await captureEvidence(page, diagnosticsDir, 'pre-load-blank');
  evidence.push(ev1);
  log.info({ url: ev1.url, png: ev1.pngPath }, 'evidence#1 captured (pre-load)');

  // ─── 加载 WA Web · 装 timing tracker ─────────────────────────
  const tracker = createNavTimingsTracker(page, WA_WEB_URL);
  log.info({ url: WA_WEB_URL, timeout: NAV_TIMEOUT_MS }, 'navigating to WA Web');
  tracker.markGoto();
  try {
    await page.goto(WA_WEB_URL, {
      waitUntil: 'networkidle2',
      timeout: NAV_TIMEOUT_MS,
    });
    tracker.markNetworkIdle();
  } catch (err) {
    // networkidle2 未达可能仍在加载 chat 数据 · 不算失败 · 只 log
    tracker.markNetworkIdleTimeout();
    log.warn({ err: err instanceof Error ? err.message : err }, 'goto did not reach networkidle2 · continuing');
  }
  log.info(tracker.snapshot(), 'nav-timings after goto');

  // ─── Evidence #2 · WA Web 加载后 (state 未定) ─────────────────
  const ev2 = await captureEvidence(page, diagnosticsDir, 'post-load-wa-web');
  evidence.push(ev2);
  log.info({ url: ev2.url, title: ev2.title, png: ev2.pngPath }, 'evidence#2 captured (post-load)');

  // ─── 状态识别循环 · D4 · 5 态机 ──────────────────────────────
  const startedAt = Date.now();
  let state: WaWebState = 'unknown';
  let matchedSelector: string | null = null;
  let firstSplashAt: number | null = null;

  while (Date.now() - startedAt < STATE_DETECT_TIMEOUT_MS) {
    const qrM = await findFirstMatch(page, WA_SELECTORS.qrCanvas);
    if (qrM.found) {
      state = 'qr';
      matchedSelector = qrM.selector;
      tracker.markStateDetected();
      break;
    }
    const chatM = await findFirstMatch(page, WA_SELECTORS.chatList);
    if (chatM.found) {
      state = 'chat-list';
      matchedSelector = chatM.selector;
      tracker.markStateDetected();
      break;
    }
    const splashM = await findFirstMatch(page, WA_SELECTORS.splash);
    if (splashM.found) {
      if (firstSplashAt === null) firstSplashAt = Date.now();
      // D4 · splash 持续超阈值 → splash-stuck (跟普通 unknown 区分开)
      if (Date.now() - firstSplashAt > SPLASH_STUCK_THRESHOLD_MS) {
        state = 'splash-stuck';
        matchedSelector = splashM.selector;
        tracker.markStateDetected();
        break;
      }
      log.info(
        { selector: splashM.selector, splashSec: Math.round((Date.now() - firstSplashAt) / 1000) },
        'splash detected · waiting',
      );
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  // 退出 loop 时仍 splash 状态 → 'splash' (不超阈值的轻微卡顿)
  if (state === 'unknown' && firstSplashAt !== null) {
    state = 'splash';
    matchedSelector = null;
  }

  // ─── QR 提取 (qr 状态时) ────────────────────────────────────
  let qrCanvasDataUrl: string | null = null;
  if (state === 'qr' && matchedSelector) {
    try {
      qrCanvasDataUrl = await page.evaluate((selectors: string[]) => {
        for (const sel of selectors) {
          const canvas = document.querySelector(sel) as HTMLCanvasElement | null;
          if (canvas) return canvas.toDataURL('image/png');
        }
        return null;
      }, WA_SELECTORS.qrCanvas);
      if (qrCanvasDataUrl) {
        log.info(
          { dataUrlBytes: qrCanvasDataUrl.length, selector: matchedSelector },
          'QR canvas extracted (raw data URL)',
        );
      } else {
        log.warn('QR selector matched but canvas.toDataURL returned null');
      }
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : err }, 'QR extract failed');
    }
  }

  // ─── Evidence #3 · 状态识别后 ─────────────────────────────────
  const ev3 = await captureEvidence(page, diagnosticsDir, `state-${state}`);
  evidence.push(ev3);
  log.info(
    { state, selector: matchedSelector, png: ev3.pngPath, hasQr: !!qrCanvasDataUrl },
    'evidence#3 captured (state-detected)',
  );

  const timings = tracker.snapshot();
  log.info(timings, 'nav-timings final · use to diagnose stall point');

  // D4-1 · DOM 法医 (任何状态都跑 · 给 unknown 提供线索)
  let forensics: DomForensicsReport | null = null;
  try {
    forensics = await runDomForensics(page);
    log.info(
      {
        unsupported: forensics.unsupportedLanding.detected,
        unsupportedText: forensics.unsupportedLanding.visibleText,
        anchors: {
          dataTestids: forensics.anchors.dataTestids.length,
          ariaLabels: forensics.anchors.ariaLabels.length,
          roles: forensics.anchors.roles.length,
        },
        qrPresent: forensics.qrCanvasPresent,
        chatListPresent: forensics.chatListPresent,
      },
      'DOM forensics summary',
    );
    await fs.writeFile(
      path.join(diagnosticsDir, `forensics-${Date.now()}.json`),
      JSON.stringify(forensics, null, 2),
      'utf-8',
    );
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, 'forensics failed');
  }

  // D4-2 · 反爬可见性
  let antiBotSignals: AntiBotSignals | null = null;
  try {
    antiBotSignals = await captureAntiBotSignals(page);
    log.info(
      {
        webdriver: antiBotSignals.navigatorWebdriver,
        ua: antiBotSignals.userAgent.slice(0, 80),
        uaChromeVersion: antiBotSignals.uaChromeVersion,
        uaIncludesHeadless: antiBotSignals.uaIncludesHeadless,
        languages: antiBotSignals.languages,
        platform: antiBotSignals.platform,
        webglRenderer: antiBotSignals.webglRenderer,
      },
      'anti-bot signals summary',
    );
    await fs.writeFile(
      path.join(diagnosticsDir, `anti-bot-signals-${Date.now()}.json`),
      JSON.stringify(antiBotSignals, null, 2),
      'utf-8',
    );
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, 'anti-bot signals failed');
  }

  // unsupported landing 检测 (D4 法医驱动 · 不改主状态机但加证据字段)
  const unsupportedDetected = forensics?.unsupportedLanding.detected ?? false;
  if (unsupportedDetected) {
    log.error(
      {
        indicators: forensics?.unsupportedLanding.indicators,
        text: forensics?.unsupportedLanding.visibleText,
      },
      'WA Web shows UNSUPPORTED BROWSER landing page · stealth/UA needs patch',
    );
  }

  return {
    state,
    detectedAt: Date.now(),
    selector: matchedSelector,
    qrCanvasDataUrl,
    evidence,
    timings,
    forensics,
    antiBotSignals,
    unsupportedDetected,
  };
}
