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

import type { Page } from 'puppeteer-core';
import type { Logger } from 'pino';
import { findFirstMatch, WA_SELECTORS } from './wa-web-selectors';
import { captureEvidence, type EvidenceShot } from './screenshot-evidence';

export type WaWebState = 'qr' | 'chat-list' | 'splash' | 'unknown';

export interface WaWebLoadResult {
  state: WaWebState;
  detectedAt: number;
  selector: string | null;
  qrCanvasDataUrl: string | null; // qr 状态时 · base64 image data URL
  evidence: EvidenceShot[];
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

  // ─── 加载 WA Web ────────────────────────────────────────────
  log.info({ url: WA_WEB_URL, timeout: NAV_TIMEOUT_MS }, 'navigating to WA Web');
  try {
    await page.goto(WA_WEB_URL, {
      waitUntil: 'networkidle2',
      timeout: NAV_TIMEOUT_MS,
    });
  } catch (err) {
    // networkidle2 未达可能仍在加载 chat 数据 · 不算失败 · 只 log
    log.warn({ err: err instanceof Error ? err.message : err }, 'goto did not reach networkidle2 · continuing');
  }

  // ─── Evidence #2 · WA Web 加载后 (state 未定) ─────────────────
  const ev2 = await captureEvidence(page, diagnosticsDir, 'post-load-wa-web');
  evidence.push(ev2);
  log.info({ url: ev2.url, title: ev2.title, png: ev2.pngPath }, 'evidence#2 captured (post-load)');

  // ─── 状态识别循环 (qr or chat-list · 45s 上限) ────────────────
  const startedAt = Date.now();
  let state: WaWebState = 'unknown';
  let matchedSelector: string | null = null;

  while (Date.now() - startedAt < STATE_DETECT_TIMEOUT_MS) {
    const qrM = await findFirstMatch(page, WA_SELECTORS.qrCanvas);
    if (qrM.found) {
      state = 'qr';
      matchedSelector = qrM.selector;
      break;
    }
    const chatM = await findFirstMatch(page, WA_SELECTORS.chatList);
    if (chatM.found) {
      state = 'chat-list';
      matchedSelector = chatM.selector;
      break;
    }
    const splashM = await findFirstMatch(page, WA_SELECTORS.splash);
    if (splashM.found) {
      // splash 可见 · 继续等真实状态出现 · 不 break
      log.info({ selector: splashM.selector }, 'splash detected · waiting for qr/chat-list');
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
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

  return {
    state,
    detectedAt: Date.now(),
    selector: matchedSelector,
    qrCanvasDataUrl,
    evidence,
  };
}
