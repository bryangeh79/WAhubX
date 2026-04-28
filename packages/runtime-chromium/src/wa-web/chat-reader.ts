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
//
// 2026-04-28 · Codex 执行单 P0-2 · 修 WA Web DOM 漂移:
//   - readLatestMessages 改用 [data-testid^="conv-msg-"] / [role="row"] · 不再依赖 'false_/true_' data-id 前缀
//   - 方向从 .message-in / .message-out 判
//   - 文本从 [data-testid="selectable-text"]
//   - waMessageId 拼成 "<dir>_<phoneE164>@s.whatsapp.net_<hash>" · phone 由 caller 传入 (hint 抽出)
//   - enterChat 接受 `__SEL__:<css>` 形态 · 命中 row root 时再下钻 gridcell click

import type { ElementHandle, Page } from 'puppeteer-core';
import type { Logger } from 'pino';
import { WA_SELECTORS } from './wa-web-selectors';

export interface HighFidelityMessage {
  /** WA 真 messageId · 拼成 '<dir>_<phoneE164>@s.whatsapp.net_<hash>' */
  waMessageId: string;
  /** 'in' (对方发) / 'out' (我方发) · 由 .message-in / .message-out class 判 */
  direction: 'in' | 'out';
  /** 消息原文 · 从 [data-testid="selectable-text"] / .selectable-text 拿 */
  text: string;
  /** 发送时间 ms · 从 data-pre-plain-text 解析 · 失败用 Date.now() */
  timestamp: number;
  /** 对方 jid · 由 caller 传入的 phoneE164 拼 · 形如 '60186888168@s.whatsapp.net' */
  senderJid: string;
  /** 对方显示名 · 由 caller 传入 (chat-list hint 抽出) */
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
  //   - "__SEL__:<css>" → 显式 CSS selector 路径 (Codex P0-1 · row.testid 不是 jid 时)
  //   - data-id 值 (e.g. "60186888168@c.us") → 用 [data-id="..."]
  //   - 完整 CSS selector (老路径 · 不带 __SEL__: prefix · 兼容)
  let rowEl: ElementHandle | null = null;
  let usedSelector = '';
  try {
    if (rowDataIdOrSelector.startsWith('__SEL__:')) {
      // 显式 selector 路径
      const sel = rowDataIdOrSelector.slice('__SEL__:'.length);
      usedSelector = sel;
      rowEl = await page.$(sel);
      // 万一 selector 命中了 row 而非 gridcell · 再往里找一次 gridcell
      if (rowEl) {
        const inner = await rowEl.$('div[role="gridcell"][tabindex="0"]');
        if (inner) {
          await rowEl.dispose();
          rowEl = inner;
          usedSelector += ' (drilled to gridcell)';
        }
      }
    } else if (rowDataIdOrSelector.includes('@') && !rowDataIdOrSelector.includes(' ')) {
      // 看起来是 JID (含 @ 且无空格 · 排除 selector 误判)
      usedSelector = `[data-id="${rowDataIdOrSelector}"]`;
      rowEl = await page.$(usedSelector);
      if (!rowEl) {
        // fallback: 模糊匹配
        const phoneOnly = rowDataIdOrSelector.split('@')[0];
        usedSelector = `[data-id*="${phoneOnly}"]`;
        rowEl = await page.$(usedSelector);
      }
    } else {
      // 老路径 · 直接当 CSS selector
      usedSelector = rowDataIdOrSelector;
      rowEl = await page.$(rowDataIdOrSelector);
    }
  } catch (err) {
    return { ok: false, error: `find row failed: ${err instanceof Error ? err.message : err}` };
  }
  if (!rowEl) {
    return { ok: false, error: `chat row not found · usedSelector=${usedSelector}` };
  }

  // click row
  try {
    await rowEl.click({ delay: 30 });
    log.debug?.({ key: rowDataIdOrSelector, usedSelector }, `${LOG_PREFIX} · row clicked`);
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
    return { ok: false, error: `chat detail not visible after ${timeoutMs}ms · usedSelector=${usedSelector}` };
  }
  await detail.dispose();
  log.info({ key: rowDataIdOrSelector, usedSelector }, `${LOG_PREFIX} · enterChat ok`);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════
// Phase D · readLatestMessages
// ═══════════════════════════════════════════════════════════════

export async function readLatestMessages(
  page: Page,
  log: Logger,
  opts: { count?: number; phoneE164?: string | null; displayName?: string | null } = {},
): Promise<HighFidelityMessage[]> {
  const N = opts.count ?? 5;
  const phoneHint = (opts.phoneE164 ?? '').replace(/[^\d]/g, '') || null;
  const displayHint = opts.displayName ?? null;

  const result = await page.evaluate(
    (selectors: typeof WA_SELECTORS, take: number): unknown[] => {
      // 1. 找 message list 容器
      let listEl: Element | null = null;
      for (const sel of selectors.messageList) {
        listEl = document.querySelector(sel);
        if (listEl) break;
      }
      if (!listEl) {
        // fallback · 大盘扫
        listEl = document.body;
      }

      // 2. 找所有 message bubble
      // 2026-04-28 · Codex P0-2 · 新 DOM:
      //   外层 row: div[role="row"]
      //   内层壳:   div[data-testid^="conv-msg-"][data-id="<HASH>"]
      //   方向:     .message-in / .message-out (在 row 或某祖父节点上)
      //   文本:     [data-testid="selectable-text"]
      //   data-id 现在只有 HASH · 不再有 false_/true_ 前缀
      //
      // 兼容老 DOM: 仍尝试 data-id 含 @ 的旧形态 (有些 fork / sticker bubble)
      const candidates: Element[] = [];
      const newShells = listEl.querySelectorAll('div[data-testid^="conv-msg-"][data-id]');
      newShells.forEach((el) => candidates.push(el));
      // 老形态 fallback (直接在 row 上有 data-id)
      const oldRows = listEl.querySelectorAll('div[role="row"][data-id]');
      oldRows.forEach((el) => {
        // 避免重复 (新壳被嵌在 row 里)
        if (!candidates.includes(el)) candidates.push(el);
      });
      // 还有更老 · 任何 data-id (扣除 chat-list listitem) 当 fallback
      if (candidates.length === 0) {
        const fallback = listEl.querySelectorAll('div[data-id]');
        fallback.forEach((el) => {
          if (el.closest('[role="listitem"]')) return;
          candidates.push(el);
        });
      }

      // 3. 方向判断: row 或 ancestor 上的 .message-in/out class
      const directionOf = (el: Element): 'in' | 'out' => {
        // 自身
        if (el.classList.contains('message-out')) return 'out';
        if (el.classList.contains('message-in')) return 'in';
        // ancestor (找最近的 row)
        const row = el.closest('[role="row"], div[class*="message-"]');
        if (row) {
          if (row.classList.contains('message-out')) return 'out';
          if (row.classList.contains('message-in')) return 'in';
          // 找内部
          if (row.querySelector('.message-out')) return 'out';
          if (row.querySelector('.message-in')) return 'in';
        }
        // 老形态 · data-id 前缀
        const dataId = el.getAttribute('data-id') ?? '';
        if (dataId.startsWith('true_')) return 'out';
        if (dataId.startsWith('false_')) return 'in';
        // 默认 in (保守 · inbound 路径不会走错)
        return 'in';
      };

      // 4. 取最后 N 条 (DOM 顺序 = 时间顺序)
      const tail = candidates.slice(-take);

      // 5. 每条提取
      const out: unknown[] = [];
      for (const b of tail) {
        const dataId = b.getAttribute('data-id') ?? '';
        if (!dataId) continue;
        const direction = directionOf(b);

        // 6. 提取 text (优先 [data-testid="selectable-text"] · 退到 .selectable-text · 退到 textContent)
        let text = '';
        const textEl =
          b.querySelector('[data-testid="selectable-text"]') ||
          b.querySelector('[data-testid="msg-text"]') ||
          b.querySelector('span.selectable-text') ||
          b.querySelector('span[class*="selectable-text"]');
        if (textEl) {
          text = (textEl.textContent ?? '').trim();
        } else {
          // 没文本元素 · 可能是媒体 / 撤回 / 系统消息 · 用占位
          if (b.querySelector('img')) text = '[image]';
          else if (b.querySelector('audio')) text = '[audio]';
          else if (b.querySelector('video')) text = '[video]';
          else text = '[non-text or unsupported]';
        }

        // 7. 提取 sender display name + timestamp · 从 data-pre-plain-text
        // WA Web 标准格式: '[HH:MM, DD/MM/YYYY] DisplayName: '
        let senderDisplay = '';
        let timestamp = Date.now();
        const prePlain =
          b.querySelector('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text') ??
          b.getAttribute('data-pre-plain-text') ??
          '';
        if (prePlain) {
          // 形如 "[10:30, 4/26/2026] Bryan Ng: "
          const m = prePlain.match(/^\[([^,]+),\s*([^\]]+)\]\s*(.*?):/);
          if (m) {
            const timeStr = m[1].trim();
            const dateStr = m[2].trim();
            senderDisplay = m[3].trim();
            try {
              const parsed = new Date(`${dateStr} ${timeStr}`);
              if (!Number.isNaN(parsed.getTime())) {
                timestamp = parsed.getTime();
              }
            } catch {
              /* keep Date.now() */
            }
          }
        }

        // dataId 提 hash · 老形态 'false_<jid>_<HASH>' · 新形态直接是 HASH
        let hashOnly = dataId;
        if (dataId.includes('_')) {
          const parts = dataId.split('_');
          hashOnly = parts[parts.length - 1];
        }

        out.push({
          // waMessageId 留空 jid 占位 · caller 替换成 phoneHint
          // 形态: <direction>_<phoneE164>@s.whatsapp.net_<hash>
          // 注: jid 部分由 caller 拼 · 这里给 caller 用的是 hash + direction
          _hashOnly: hashOnly,
          _rawDataId: dataId,
          direction,
          text,
          timestamp,
          // senderJid / senderDisplay 留空 · caller 用 hint 填
          senderDisplay,
        });
      }
      return out;
    },
    WA_SELECTORS,
    N,
  );

  // 应用 caller hint · 拼 waMessageId / senderJid / senderDisplay
  const arr = (result as Array<{
    _hashOnly: string;
    _rawDataId: string;
    direction: 'in' | 'out';
    text: string;
    timestamp: number;
    senderDisplay: string;
  }>) ?? [];

  const messages: HighFidelityMessage[] = arr.map((m) => {
    const senderJid = phoneHint ? `${phoneHint}@s.whatsapp.net` : '';
    // waMessageId · 用 hash + direction + jid 拼 (有 jid 则带; 没 jid 退化到 _rawDataId)
    let waMessageId: string;
    if (phoneHint && m._hashOnly) {
      waMessageId = `${m.direction === 'out' ? 'true' : 'false'}_${phoneHint}@s.whatsapp.net_${m._hashOnly}`;
    } else {
      // 没 phone hint · 用原始 data-id (老路径兼容 · backend 可能依然能识别)
      waMessageId = m._rawDataId;
    }
    return {
      waMessageId,
      direction: m.direction,
      text: m.text,
      timestamp: m.timestamp,
      senderJid,
      senderDisplay: m.senderDisplay || (displayHint ?? ''),
    };
  });

  log.info(
    { count: messages.length, take: N, phoneHint, displayHint },
    `${LOG_PREFIX} · readLatestMessages 抓到 ${messages.length} 条`,
  );
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
