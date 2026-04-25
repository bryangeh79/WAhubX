// 2026-04-25 · D10 W2 · inbound 消息监听 (Codex 锁: DOM observer + 最小去重)
//
// 范围:
//   ✓ 监听整个 chat-list pane 的"未读 badge" 变化
//   ✓ 命中即拉对方的 phone + 最新一条文本预览
//   ✓ pseudoMessageId 去重 (60s 滑动窗口)
//
// 不在范围:
//   ✗ 准确读取消息内容 (需进 chat 才能拿到完整 text · D11+)
//   ✗ takeover / intelligent-reply 联动
//   ✗ 媒体消息解析 (image/voice 内容)
//
// 工作原理:
//   - page.exposeFunction 把 onIncoming 暴露给 page
//   - page.evaluateOnNewDocument 注入 MutationObserver
//   - observer 监听 [data-testid="chat-list"] 内 children 变化
//   - 检测到新"unread badge" 出现 → 调 onIncoming(chatPreview)

import type { Page } from 'puppeteer-core';
import type { Logger } from 'pino';

export interface IncomingMessageHint {
  /** 对方的预览名 (DOM aria-label · 可能含 phone 或保存的联系人名) */
  preview: string;
  /** 解析出的 E164 phone (从 jid 或 aria-label 提取 · 失败则 null) */
  phoneE164: string | null;
  /** 最新一条消息的预览文本 (chat list 显示的截断版 · 不是完整消息体) */
  lastMessagePreview: string | null;
  /** 未读数 badge */
  unreadCount: number;
  /** 探测到的本地时间 ms */
  detectedAt: number;
  /** 内部 dedupe key (preview + lastMessagePreview hash · 60s 内同 key 视为同条) */
  dedupeKey: string;
}

export interface InboundWatcherOptions {
  /** 命中新消息时回调 (runtime 通过 emitMessageUpsert 推 backend) */
  onIncoming: (hint: IncomingMessageHint) => void;
  /** dedupe 窗口 · 默认 60s */
  dedupeWindowMs?: number;
  log: Logger;
}

const DEFAULT_DEDUPE_WINDOW_MS = 60_000;

/**
 * 安装 inbound watcher · 必须在 chat-list 状态调
 */
export async function installInboundWatcher(
  page: Page,
  opts: InboundWatcherOptions,
): Promise<{ uninstall: () => Promise<void> }> {
  const dedupeWindowMs = opts.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;
  // 暴露 callback · page 内可通过 window.__wahubxOnIncoming 调
  // 名字加 prefix · 防 page JS 命名冲突
  const callbackName = '__wahubxOnIncoming';
  const dedupeMap = new Map<string, number>();

  await page.exposeFunction(callbackName, (raw: unknown) => {
    try {
      const hint = raw as IncomingMessageHint;
      if (!hint || typeof hint !== 'object') return;
      // 去重
      const now = Date.now();
      const lastSeen = dedupeMap.get(hint.dedupeKey);
      if (lastSeen && now - lastSeen < dedupeWindowMs) {
        return; // 60s 内重复 · 丢
      }
      dedupeMap.set(hint.dedupeKey, now);
      // 清旧 key (简单 GC · 大于 5 倍窗口的删)
      if (dedupeMap.size > 200) {
        const cutoff = now - dedupeWindowMs * 5;
        for (const [k, t] of dedupeMap.entries()) {
          if (t < cutoff) dedupeMap.delete(k);
        }
      }
      opts.onIncoming(hint);
    } catch (err) {
      opts.log.warn({ err: err instanceof Error ? err.message : err }, 'inbound onIncoming threw');
    }
  });

  // 注入 MutationObserver
  // 这个脚本在 page context 跑 · 不能用 Node API · 不能 import
  await page.evaluate((cbName: string) => {
    const w = window as unknown as { [k: string]: unknown };
    const cb = w[cbName] as ((hint: unknown) => void) | undefined;
    if (!cb) return;

    const PANE_SELECTORS = ['[data-testid="chat-list"]', '#pane-side', 'div[role="grid"][aria-label*="Chat"]'];
    const findPane = (): Element | null => {
      for (const sel of PANE_SELECTORS) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      return null;
    };

    /** 从 chat row 抽取 hint */
    const extractHint = (row: Element): {
      preview: string;
      phoneE164: string | null;
      lastMessagePreview: string | null;
      unreadCount: number;
      detectedAt: number;
      dedupeKey: string;
    } | null => {
      // chat row 通常在 aria-label / title / [tabindex] · 不同 WA 版本不一样
      // 简化: 取 row.textContent 前 80 字符作 preview
      const text = (row.textContent ?? '').trim().slice(0, 200);
      if (!text) return null;
      // unread badge: span[aria-label*="unread"] / span[data-testid="icon-unread-count"]
      let unread = 0;
      const badge =
        row.querySelector('span[aria-label*="unread"]') ||
        row.querySelector('span[data-testid="icon-unread-count"]') ||
        row.querySelector('span[role="status"]');
      if (badge) {
        const t = (badge.textContent ?? '').trim();
        const n = parseInt(t, 10);
        if (Number.isFinite(n)) unread = n;
        else unread = 1;
      }
      if (unread <= 0) return null; // 没未读 = 不上报

      // phone: WA Web row 通常没直接 phone · 我们从 aria-label / data-id 试拉
      let phone: string | null = null;
      const ariaLabel =
        row.getAttribute('aria-label') ||
        (row.querySelector('[aria-label]')?.getAttribute('aria-label') ?? '');
      const phoneMatch = ariaLabel.match(/(\+?\d[\d\s-]{6,15}\d)/);
      if (phoneMatch) phone = phoneMatch[1].replace(/[^\d+]/g, '');

      // 最后一条消息预览 (row 里通常有 [data-testid="last-msg-content"] 或最后一个 span)
      let lastMsg: string | null = null;
      const lastEl =
        row.querySelector('[data-testid="last-msg-content"]') ||
        row.querySelector('span[dir]:last-of-type') ||
        row.querySelector('div > span:last-of-type');
      if (lastEl) lastMsg = (lastEl.textContent ?? '').trim().slice(0, 200);

      // dedupe key · preview + lastMsg 简单 hash
      const dedupeKey = `${text.slice(0, 50)}|${lastMsg ?? ''}|${unread}`;

      return {
        preview: text.slice(0, 80),
        phoneE164: phone,
        lastMessagePreview: lastMsg,
        unreadCount: unread,
        detectedAt: Date.now(),
        dedupeKey,
      };
    };

    const observe = (pane: Element): MutationObserver => {
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          // 任何 row 结构变 · 重新扫该 row 的状态
          const row = (m.target as Element).closest('[role="listitem"], div[data-testid*="cell"]');
          if (!row) continue;
          const hint = extractHint(row);
          if (hint) {
            try {
              cb(hint);
            } catch {
              /* ignore */
            }
          }
        }
      });
      observer.observe(pane, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-label', 'data-id', 'class'],
      });
      return observer;
    };

    let pane = findPane();
    let observer: MutationObserver | null = pane ? observe(pane) : null;

    // 如果 pane 还没 mount · 等 50 次 each 500ms (25s)
    let retry = 0;
    const retryTimer = setInterval(() => {
      if (observer) {
        clearInterval(retryTimer);
        return;
      }
      retry += 1;
      if (retry > 50) {
        clearInterval(retryTimer);
        return;
      }
      pane = findPane();
      if (pane) {
        observer = observe(pane);
        clearInterval(retryTimer);
      }
    }, 500);

    // 把 observer ref 暴露给 uninstall 用
    (window as unknown as { __wahubxObserver?: MutationObserver | null }).__wahubxObserver = observer;
  }, callbackName);

  opts.log.info('D10 inbound watcher installed · MutationObserver on chat-list pane');

  const uninstall = async (): Promise<void> => {
    try {
      await page.evaluate(() => {
        const w = window as unknown as { __wahubxObserver?: MutationObserver | null };
        if (w.__wahubxObserver) {
          w.__wahubxObserver.disconnect();
          w.__wahubxObserver = null;
        }
      });
    } catch {
      /* ignore */
    }
  };
  return { uninstall };
}
