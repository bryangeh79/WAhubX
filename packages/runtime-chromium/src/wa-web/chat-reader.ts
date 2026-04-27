// 2026-04-26 · P0.11 · 高保真 inbound · 进 chat 读真消息
//
// 范围 (battleplan §5):
//   ✓ enterChat(rowSelector) · click row · 等 chat detail (header / message list)
//   ✓ readLatestMessages(N=5) · 扫 message bubble · 提 dataId / direction / text / timestamp
//   ✓ exitChat() · ESC / back / close · 等 chat-list 重出现
//
// 不在范围:
//   ✗ 媒体消息真读 (image/voice content) · 占位符 [image] / [file]
//   ✗ 撤回 / 编辑 · 不处理
//   ✗ 群消息 · 单聊先通 · 群留 M11
//   ✗ 长按 unread · WA Web 没有真"标已读 toggle" · 进 chat 自动标 · 接受 trade-off

import type { ElementHandle, Page } from 'puppeteer-core';
import type { Logger } from 'pino';
import { WA_SELECTORS } from './wa-web-selectors';

export interface HighFidelityMessage {
  /** WA 真 messageId · 从 message bubble data-id 抽 · 形如 'false_60186888168@c.us_3EB0...HASH' */
  waMessageId: string;
  /** 'in' (对方发) / 'out' (我方发) · 从 data-id 前缀 'false_'/'true_' 判 */
  direction: 'in' | 'out';
  /** 消息原文 · 从 [data-testid="msg-text"] / .selectable-text 拿 */
  text: string;
  /** 发送时间 ms · 从 data-pre-plain-text 解析 · 失败用 Date.now() */
  timestamp: number;
  /** 对方 jid · 从 data-id 中段抽 · 形如 '60186888168@c.us' */
  senderJid: string;
  /** 对方显示名 · 从 data-pre-plain-text "[HH:MM, DD/MM/YYYY] DisplayName: " 拿 */
  senderDisplay: string;
}

const LOG_PREFIX = 'P0.11 chat-reader';

// 多 selector poll 工具 · 跟 actions.ts 那个同款
async function tryEachSelector(page: Page, selectors: string[]): Promise<ElementHandle | null> {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) return el;
    } catch {
      /* try next */
    }
  }
  return null;
}

async function waitForAnyElement(
  page: Page,
  selectors: string[],
  timeoutMs: number,
): Promise<ElementHandle | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const found = await tryEachSelector(page, selectors);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// Phase C · enterChat
// ═══════════════════════════════════════════════════════════════

export async function enterChat(
  page: Page,
  rowDataIdOrSelector: string,
  log: Logger,
  timeoutMs = 5000,
): Promise<{ ok: boolean; error?: string }> {
  // 找 row
  // rowDataIdOrSelector 可能是:
  //   - data-id 值 (e.g. "60186888168@c.us") → 用 [data-id="..."]
  //   - 完整 CSS selector
  let rowEl: ElementHandle | null = null;
  try {
    if (rowDataIdOrSelector.includes('@')) {
      // data-id 值
      rowEl = await page.$(`[data-id="${rowDataIdOrSelector}"]`);
      if (!rowEl) {
        // fallback: 模糊匹配
        rowEl = await page.$(`[data-id*="${rowDataIdOrSelector.split('@')[0]}"]`);
      }
    } else {
      rowEl = await page.$(rowDataIdOrSelector);
    }
  } catch (err) {
    return { ok: false, error: `find row failed: ${err instanceof Error ? err.message : err}` };
  }
  if (!rowEl) {
    return { ok: false, error: `chat row not found · key=${rowDataIdOrSelector}` };
  }

  // click row
  try {
    await rowEl.click({ delay: 30 });
    log.debug?.({ key: rowDataIdOrSelector }, `${LOG_PREFIX} · row clicked`);
  } catch (err) {
    await rowEl.dispose();
    return { ok: false, error: `row click failed: ${err instanceof Error ? err.message : err}` };
  }
  await rowEl.dispose();

  // 等 chat detail 出现 (header / message list 任一)
  const detail = await waitForAnyElement(
    page,
    [
      ...WA_SELECTORS.chatHeader,
      ...WA_SELECTORS.messageList,
    ],
    timeoutMs,
  );
  if (!detail) {
    return { ok: false, error: `chat detail not visible after ${timeoutMs}ms` };
  }
  await detail.dispose();
  log.info({ key: rowDataIdOrSelector }, `${LOG_PREFIX} · enterChat ok`);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════
// Phase D · readLatestMessages
// ═══════════════════════════════════════════════════════════════

export async function readLatestMessages(
  page: Page,
  log: Logger,
  opts: { count?: number } = {},
): Promise<HighFidelityMessage[]> {
  const N = opts.count ?? 5;

  const result = await page.evaluate(
    (selectors: typeof WA_SELECTORS, take: number): unknown[] => {
      // 1. 找 message list 容器
      let listEl: Element | null = null;
      for (const sel of selectors.messageList) {
        listEl = document.querySelector(sel);
        if (listEl) break;
      }
      if (!listEl) {
        // fallback · 大盘扫所有 [data-id] 含 jid 形态
        listEl = document.body;
      }

      // 2. 找所有 message bubble
      const bubbles: Element[] = [];
      // 优先 testid · 不行回退到任何带 data-id 的非 listitem 元素
      const sel = 'div[data-testid*="msg-container"], div[data-id]:not([role="listitem"]), div[role="row"]';
      const all = listEl.querySelectorAll(sel);
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        const dataId = el.getAttribute('data-id') ?? '';
        // 只要有 data-id · 跳掉 chat-list row (含 @c.us 没有 _ 前缀)
        if (dataId && (dataId.startsWith('false_') || dataId.startsWith('true_'))) {
          bubbles.push(el);
        }
      }

      // 3. 取最后 N 条 (DOM 顺序 = 时间顺序)
      const tail = bubbles.slice(-take);

      // 4. 每条提取
      const out: unknown[] = [];
      for (const b of tail) {
        const dataId = b.getAttribute('data-id') ?? '';
        if (!dataId) continue;
        // 解析 data-id: 'false_60186888168@c.us_3EB0...HASH'  / 'true_<jid>_<hash>'
        const direction: 'in' | 'out' = dataId.startsWith('true_') ? 'out' : 'in';
        // 提 jid (中间段)
        // false_60186888168@c.us_3EB0...HASH
        // ↑      ↑                 ↑
        // dir    jid               hash
        const dataIdParts = dataId.split('_');
        // 至少 3 段才像合法
        const senderJid = dataIdParts.length >= 3 ? dataIdParts[1] : '';

        // 5. 提取 text (优先 [data-testid=msg-text] · 退到 .selectable-text · 退到 textContent)
        let text = '';
        const textEl = b.querySelector('[data-testid="msg-text"]')
          || b.querySelector('span.selectable-text')
          || b.querySelector('span[class*="selectable-text"]');
        if (textEl) {
          text = (textEl.textContent ?? '').trim();
        } else {
          // 没文本元素 · 可能是媒体 / 撤回 / 系统消息 · 用占位
          // 检测有没有 image / video / audio
          if (b.querySelector('img')) text = '[image]';
          else if (b.querySelector('audio')) text = '[audio]';
          else if (b.querySelector('video')) text = '[video]';
          else text = '[non-text or unsupported]';
        }

        // 6. 提取 sender display name + timestamp · 从 data-pre-plain-text
        // WA Web 标准格式: '[HH:MM, DD/MM/YYYY] DisplayName: '
        let senderDisplay = '';
        let timestamp = Date.now();
        const prePlain = b.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text')
          ?? b.getAttribute('data-pre-plain-text')
          ?? '';
        if (prePlain) {
          // 形如 "[10:30, 4/26/2026] Bryan Ng: "
          const m = prePlain.match(/^\[([^,]+),\s*([^\]]+)\]\s*(.*?):/);
          if (m) {
            const timeStr = m[1].trim(); // "10:30" or "10:30 PM"
            const dateStr = m[2].trim(); // "4/26/2026"
            senderDisplay = m[3].trim();
            // 解析时间
            try {
              // 'D/M/YYYY' or 'M/D/YYYY' 看 locale · 这里粗暴接受 native parse
              const parsed = new Date(`${dateStr} ${timeStr}`);
              if (!Number.isNaN(parsed.getTime())) {
                timestamp = parsed.getTime();
              }
            } catch {
              /* keep Date.now() */
            }
          }
        }
        // direction=out 时 senderDisplay = 自己 · 我们的 senderDisplay 占位
        if (direction === 'out' && !senderDisplay) {
          senderDisplay = '(self)';
        }

        out.push({
          waMessageId: dataId,
          direction,
          text,
          timestamp,
          senderJid,
          senderDisplay,
        });
      }
      return out;
    },
    WA_SELECTORS,
    N,
  );

  const messages = (result as HighFidelityMessage[]) ?? [];
  log.info({ count: messages.length, take: N }, `${LOG_PREFIX} · readLatestMessages 抓到 ${messages.length} 条`);
  return messages;
}

// ═══════════════════════════════════════════════════════════════
// Phase E · exitChat
// ═══════════════════════════════════════════════════════════════

export async function exitChat(
  page: Page,
  log: Logger,
  timeoutMs = 5000,
): Promise<{ ok: boolean; error?: string }> {
  // 优先尝试 ESC keyboard (兼容 WA Web 各版本)
  try {
    await page.keyboard.press('Escape');
  } catch {
    /* ignore · 试 click */
  }

  // 等 chat-list pane 重出现 · 同时 message list 不见
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // chat-list 出现 = 退成功
    const chatList = await tryEachSelector(page, WA_SELECTORS.chatList);
    if (chatList) {
      await chatList.dispose();
      log.debug?.(`${LOG_PREFIX} · exitChat ok (ESC)`);
      return { ok: true };
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  // ESC 没生效 · 试 back/close button
  for (const sel of [...WA_SELECTORS.chatBackButton ?? [], ...WA_SELECTORS.chatCloseButton ?? []]) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click({ delay: 30 });
        await el.dispose();
        await new Promise((r) => setTimeout(r, 500));
        const chatList = await tryEachSelector(page, WA_SELECTORS.chatList);
        if (chatList) {
          await chatList.dispose();
          log.debug?.({ sel }, `${LOG_PREFIX} · exitChat ok (back/close)`);
          return { ok: true };
        }
      }
    } catch {
      /* try next */
    }
  }

  log.warn(`${LOG_PREFIX} · exitChat 超时 · chat-list 未重出现`);
  return { ok: false, error: 'chat-list not visible after exit attempt' };
}
