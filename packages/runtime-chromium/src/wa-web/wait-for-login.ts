// 2026-04-25 · D6 · 命中 qr 后长 poll 等 chat-list
//
// 职责:
//   - 长时间 (默认 10 min) 等 chat-list selector 出现
//   - 期间检测 QR 是否被 WA 刷新 (~30s 一次) · 重新落 last-qr.dataurl.txt
//   - 命中 chat-list → 截最后一张证据 + 返回成功
//   - 超时 → 返 timeout · 主流程继续 heartbeat 不退出
//
// 不在范围 (D6 锁定):
//   - WS bridge (D7+)
//   - sendText (D7+)

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Page } from 'puppeteer-core';
import type { Logger } from 'pino';
import { findFirstMatch, WA_SELECTORS } from './wa-web-selectors';
import { captureEvidence } from './screenshot-evidence';

export interface WaitForLoginOptions {
  page: Page;
  diagnosticsDir: string;
  log: Logger;
  timeoutMs?: number;       // 默认 10 min · 真扫码场景
  pollIntervalMs?: number;  // 默认 2s
  refreshQrEverySec?: number; // QR 自动刷新检测 · 默认 25s 重新提一次 · 即使 selector 没变
  // 2026-04-25 · D8-2 · QR 刷新时回调 · backend 通过 WS 拿到推 UI
  onQrRefresh?: (dataUrl: string, refreshCount: number) => void;
  // 2026-04-25 · D8-2 · 取消信号 · cancel-bind 命令触发
  cancelSignal?: AbortSignal;
}

export interface WaitForLoginResult {
  outcome: 'chat-list' | 'timeout' | 'error' | 'cancelled';
  durationMs: number;
  qrRefreshCount: number;
  finalState: 'qr' | 'chat-list' | 'splash' | 'unknown';
  chatListSelector: string | null;
  error?: string;
}

const DEFAULT_TIMEOUT = 10 * 60 * 1000;
const DEFAULT_POLL = 2000;
const DEFAULT_QR_REFRESH = 25_000;

/**
 * 长 poll 等 chat-list · 同时定期重提 QR
 */
export async function waitForLogin(opts: WaitForLoginOptions): Promise<WaitForLoginResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const pollMs = opts.pollIntervalMs ?? DEFAULT_POLL;
  const qrRefreshMs = (opts.refreshQrEverySec ?? DEFAULT_QR_REFRESH);
  const startedAt = Date.now();
  let lastQrAt = startedAt;
  let qrRefreshCount = 0;
  const log = opts.log;

  log.info({ timeoutMs, pollMs, qrRefreshMs }, 'D6 waitForLogin started · 等用户扫码');

  while (Date.now() - startedAt < timeoutMs) {
    // 2026-04-25 · D8-2 · 取消信号检查 (每轮 poll 前)
    if (opts.cancelSignal?.aborted) {
      log.warn({ qrRefreshCount }, 'D8-2 waitForLogin CANCELLED · cancel-bind 命令触发');
      return {
        outcome: 'cancelled',
        durationMs: Date.now() - startedAt,
        qrRefreshCount,
        finalState: 'qr',
        chatListSelector: null,
      };
    }

    // 命中 chat-list = 成功
    const chatM = await findFirstMatch(opts.page, WA_SELECTORS.chatList);
    if (chatM.found) {
      const dur = Date.now() - startedAt;
      log.info({ selector: chatM.selector, durationMs: dur, qrRefreshes: qrRefreshCount }, 'D6 LOGIN SUCCESS · chat-list 出现');
      try {
        await captureEvidence(opts.page, opts.diagnosticsDir, 'd6-login-success-chat-list');
      } catch {
        /* ignore */
      }
      return {
        outcome: 'chat-list',
        durationMs: dur,
        qrRefreshCount,
        finalState: 'chat-list',
        chatListSelector: chatM.selector,
      };
    }

    // 还在 qr · 检测 QR 是否需 refresh (重新提 dataUrl 落盘)
    const qrM = await findFirstMatch(opts.page, WA_SELECTORS.qrCanvas);
    if (qrM.found && Date.now() - lastQrAt > qrRefreshMs) {
      try {
        const newQrDataUrl = await opts.page.evaluate((selectors: string[]) => {
          for (const sel of selectors) {
            const canvas = document.querySelector(sel) as HTMLCanvasElement | null;
            if (canvas) return canvas.toDataURL('image/png');
          }
          return null;
        }, WA_SELECTORS.qrCanvas);
        if (newQrDataUrl) {
          const qrPath = path.join(opts.diagnosticsDir, 'last-qr.dataurl.txt');
          await fs.writeFile(qrPath, newQrDataUrl, 'utf-8');
          qrRefreshCount += 1;
          lastQrAt = Date.now();
          log.info({ qrRefreshCount, bytes: newQrDataUrl.length }, 'QR refreshed (落盘 last-qr.dataurl.txt)');
          // 2026-04-25 · D8-2 · 推给 backend (经 WS · backend 缓存供 UI 拉)
          if (opts.onQrRefresh) {
            try {
              opts.onQrRefresh(newQrDataUrl, qrRefreshCount);
            } catch (cbErr) {
              log.warn({ err: cbErr instanceof Error ? cbErr.message : cbErr }, 'onQrRefresh callback threw');
            }
          }
        }
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.message : err }, 'QR refresh extraction failed');
      }
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }

  const dur = Date.now() - startedAt;
  log.warn({ durationMs: dur, qrRefreshCount }, 'D6 waitForLogin TIMEOUT · 用户未扫');
  try {
    await captureEvidence(opts.page, opts.diagnosticsDir, 'd6-login-timeout');
  } catch {
    /* ignore */
  }
  return {
    outcome: 'timeout',
    durationMs: dur,
    qrRefreshCount,
    finalState: 'qr',
    chatListSelector: null,
  };
}
