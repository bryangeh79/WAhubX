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
  /** 内部 dedupe key */
  dedupeKey: string;
  // 2026-04-25 · B 路线 · 最小可用 inbound · 标识来源
  // - phone:       从 aria-label / data-id 抽到的真手机号
  // - jid-attr:    从 data-id JID 形态 (XXXX@c.us / @s.whatsapp.net) 抽
  // - displayName: 退化方案 · 用 contact 显示名当 synthetic key
  // - unknown:     都失败 (前端不该用这条 · backend 也会丢)
  identitySource?: 'phone' | 'jid-attr' | 'displayName' | 'unknown';
  /** 显示名 (saved contact 名 / 推送名 / phone) · synthetic JID 用 */
  displayName?: string | null;
  // 2026-04-26 · P0.11 · row 上抓到的 jid (e.g. "60186888168@c.us") · runtime worker 用此 click row 进 chat 拿真消息
  rowDataId?: string | null;
}

export interface InboundWatcherOptions {
  /** 命中新消息时回调 (runtime 通过 emitMessageUpsert 推 backend) */
  onIncoming: (hint: IncomingMessageHint) => void;
  /** dedupe 窗口 · 默认 60s */
  dedupeWindowMs?: number;
  log: Logger;
}

// 2026-04-28 · 5s → 60s
//   bug: 加了 5s poll 后 · 同 row 每 5s 都重新 fire · 后端 8s 聚合 timer 反复被 reset · 永不 flush
//   60s 窗 + 去 30s 时间桶 (见下) → 同 row 60s 内只 fire 1 次 · 8s 聚合稳定 fire → AI 回复发出
//   真客户连发多条会改 unread count · dedupeKey 含 unread → 仍可识别新消息
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
    // 2026-04-25 · B 路线 · 多策略抽身份 + identitySource 打标
    // 2026-04-26 · P0.11 · 加 rowDataId 字段 (chat-reader 进 chat 用)
    const extractHint = (row: Element): {
      preview: string;
      phoneE164: string | null;
      lastMessagePreview: string | null;
      unreadCount: number;
      detectedAt: number;
      dedupeKey: string;
      identitySource: 'phone' | 'jid-attr' | 'displayName' | 'unknown';
      displayName: string | null;
      rowDataId: string | null;
    } | null => {
      // chat row 通常在 aria-label / title / [tabindex] · 不同 WA 版本不一样
      // 简化: 取 row.textContent 前 80 字符作 preview
      const text = (row.textContent ?? '').trim().slice(0, 200);
      if (!text) return null;
      // 2026-04-28 · 收紧 unread badge 检测 · 排除系统消息噪声
      //   老 selector `span[role="status"]` 太宽 · WA 系统消息 (verified business / online status) 都命中
      //   现在只信: span[aria-label*="unread"] (含数字) + 严格的纯数字 badge
      let unread = 0;
      // 策略 A · aria-label 含 "unread" 关键字 (最权威 · WA accessibility 用)
      const aA = row.querySelector('span[aria-label*="unread" i]');
      if (aA) {
        const al = aA.getAttribute('aria-label') ?? '';
        const m = al.match(/(\d+)\s*unread/i);
        if (m) unread = parseInt(m[1], 10);
        else unread = 1;
      }
      // 策略 B · data-testid 显式 (老版 WA Web)
      if (unread <= 0) {
        const aB = row.querySelector('span[data-testid="icon-unread-count"]');
        if (aB) {
          const n = parseInt((aB.textContent ?? '').trim(), 10);
          if (Number.isFinite(n) && n > 0) unread = n;
        }
      }
      // 策略 C · 找 row 内圆形 badge (绿色圈 · 通常是纯数字)
      //   严格: span 必须 textContent 是 1-3 位纯数字 · 防 "verified" / "·" / "online" 等
      if (unread <= 0) {
        const candidates = row.querySelectorAll('span[aria-hidden="true"], span:not([role])');
        for (let i = 0; i < candidates.length; i++) {
          const t = (candidates[i].textContent ?? '').trim();
          if (/^\d{1,3}$/.test(t)) {
            unread = parseInt(t, 10);
            break;
          }
        }
      }
      if (unread <= 0) return null; // 没未读 = 不上报

      // 2026-04-28 · 系统/官方消息黑名单 · 即便有 unread 也跳 (避免误回)
      const SYSTEM_BLACKLIST = [
        'WhatsApp',
        'Meta Verified',
        'Meta AI',
        'Sync your contacts',
        'This business is now using',
        'Your messages are end-to-end',
        'Welcome to WhatsApp',
      ];
      const lcText = text.toLowerCase();
      for (const sys of SYSTEM_BLACKLIST) {
        if (lcText.includes(sys.toLowerCase())) return null;
      }

      // ─── 多策略身份提取 (B 路线 · 优先级: phone > jid-attr > displayName) ───
      let phone: string | null = null;
      let identitySource: 'phone' | 'jid-attr' | 'displayName' | 'unknown' = 'unknown';
      // 2026-04-26 · P0.11 · row 上完整 jid (含 server) · runtime chat-reader 用此 click row
      let rowDataId: string | null = null;

      const ariaLabel =
        row.getAttribute('aria-label') ||
        (row.querySelector('[aria-label]')?.getAttribute('aria-label') ?? '');

      // 策略 1: aria-label 直接含 + 国家码数字串
      const phoneMatch = ariaLabel.match(/(\+?\d[\d\s-]{6,15}\d)/);
      if (phoneMatch) {
        phone = phoneMatch[1].replace(/[^\d+]/g, '');
        identitySource = 'phone';
      }

      // 策略 2: 扫 row 内任何 attribute / data-id 含 JID 形态 (`<phone>@c.us` / `@s.whatsapp.net` / `@lid`)
      // WA Web row 常带 data-id="false_60186888168@c.us_3EB0..."  · 拆 _ 后第二段就是 jid
      // chat-list row 的 data-id 通常直接是 jid (无 _ 前缀)
      if (!phone || !rowDataId) {
        const allEls = [row, ...Array.from(row.querySelectorAll('*'))];
        const JID_RE = /(\d{8,15})(?::\d+)?@(c\.us|s\.whatsapp\.net|lid)/;
        for (const el of allEls) {
          // 全 attribute 扫
          for (const attr of Array.from(el.attributes ?? [])) {
            const m = attr.value.match(JID_RE);
            if (m) {
              if (!phone) {
                phone = m[1];
                identitySource = 'jid-attr';
              }
              if (!rowDataId) {
                // 整段 jid (含 server) · 用作 chat-reader.enterChat 的 key
                rowDataId = `${m[1]}@${m[2]}`;
              }
              break;
            }
          }
          if (phone && rowDataId) break;
        }
      }

      // 策略 3: 退化 · 拿 displayName (saved contact 名)
      // 2026-04-25 · B 路线 · iter 2 · 修 "抓到 unread badge 文本/typing/时间" bug
      //
      // WA Web chat-list row aria-label 形如 (区域顺序不稳):
      //   "X unread messages. ContactName. Yesterday. ..."
      // 我们必须**剔除状态片段** (unread badge / typing / time)
      // 然后优先用 [title] / span[dir="auto"][title] (DOM 上 contact 名最干净处)
      let displayName: string | null = null;

      // 状态片段过滤器 · 命中 → 跳
      const isStatusText = (t: string): boolean => {
        const lc = t.trim().toLowerCase();
        if (!lc) return true;
        if (/^\d+\s*unread\b/i.test(lc)) return true;          // "2 unread messages"
        if (/^typing[\s.…]*$/i.test(lc)) return true;          // "typing…"
        if (/^(yesterday|today|now|just now)$/i.test(lc)) return true;
        if (/^\d{1,2}[:.]\d{2}(\s*(am|pm))?$/i.test(lc)) return true; // "10:23" / "10:23 pm"
        if (/^\d+\s*(min|hour|day|week)s?\s*ago$/i.test(lc)) return true;
        if (/^(mon|tue|wed|thu|fri|sat|sun)/i.test(lc)) return true;
        return false;
      };

      // 优先级 A: 找 row 内 [title] 属性 (typical contact name 位置)
      const titleEls = row.querySelectorAll('[title]');
      for (let i = 0; i < titleEls.length; i++) {
        const t = titleEls[i].getAttribute('title')?.trim() ?? '';
        if (t && !isStatusText(t)) {
          displayName = t.slice(0, 80);
          break;
        }
      }

      // 优先级 B: span[dir="auto"] 的 textContent (chat-list contact 名常用)
      if (!displayName) {
        const dirAutoEls = row.querySelectorAll('span[dir="auto"]');
        for (let i = 0; i < dirAutoEls.length; i++) {
          const t = (dirAutoEls[i].textContent ?? '').trim();
          if (t && !isStatusText(t) && t.length <= 80) {
            displayName = t;
            break;
          }
        }
      }

      // 优先级 C: aria-label 拆段 + 过滤
      if (!displayName && ariaLabel) {
        const segs = ariaLabel.split(/[·.]/).map((s) => s.trim()).filter((s) => s);
        for (const seg of segs) {
          if (!isStatusText(seg) && seg.length <= 80) {
            displayName = seg;
            break;
          }
        }
      }

      // 2026-04-28 · 关键修 · displayName 看起来像 phone 时也提取 phone
      //   bug: 客户号 "+60 18-688 8168" 被当 displayName · 没存 phone
      //        auto-reply-decider jidToPhone() 在 synthetic JID 上返 null · 退出
      //        客户没回应
      //   修: 任何字段 (displayName 优先 · 然后 text) 含 8+ 位连续数字串 · 提为 phone
      if (!phone && displayName) {
        const m = displayName.match(/\+?\s*(\d[\d\s\-()]{6,18}\d)/);
        if (m) {
          phone = m[1].replace(/[^\d]/g, '');
          if (phone.length >= 8 && phone.length <= 15) {
            identitySource = 'phone';
          } else {
            phone = null;
          }
        }
      }
      // 兜底: 从 row.textContent 抓
      if (!phone) {
        const m = text.match(/\+?(\d{8,15})/);
        if (m) {
          phone = m[1];
          identitySource = 'phone';
        }
      }
      if (!phone && displayName) {
        identitySource = 'displayName';
      } else if (!phone && !displayName) {
        identitySource = 'unknown';
      }

      // 最后一条消息预览 (row 里通常有 [data-testid="last-msg-content"] 或最后一个 span)
      // 2026-04-28 · 加严过滤 · 防把 chat 标题 (= 客户号码) 当消息内容
      //   bug: WA Web row 多个 span 都有 dir 属性 · :last-of-type 可能命中标题 / 时间 · 不是消息预览
      //   修: 跳过明显是"标题"的内容 (跟 displayName 完全相同 / 纯数字号码 / 纯时间)
      let lastMsg: string | null = null;
      const lastCandidates: string[] = [];
      const lastEl1 = row.querySelector('[data-testid="last-msg-content"]');
      if (lastEl1) lastCandidates.push((lastEl1.textContent ?? '').trim());
      // 收集多个候选 · 找第一个看起来像真消息的
      const dirSpans = row.querySelectorAll('span[dir]');
      for (let i = 0; i < dirSpans.length; i++) {
        const t = (dirSpans[i].textContent ?? '').trim();
        if (t) lastCandidates.push(t);
      }
      const isPhoneLike = (s: string) => /^[\+\d\s\-\(\)]{6,}$/.test(s);
      const isTimeLike = (s: string) =>
        /^\d{1,2}[:.]\d{2}(\s*(am|pm))?$/i.test(s) ||
        /^(yesterday|today|now|just now)$/i.test(s) ||
        /^\d+\s*(min|hour|day|week)s?\s*ago$/i.test(s) ||
        /^(mon|tue|wed|thu|fri|sat|sun)/i.test(s);
      for (const c of lastCandidates) {
        const cTrim = c.slice(0, 200);
        if (!cTrim) continue;
        // 跳过跟 displayName 一样的 (= 标题被当 preview)
        if (displayName && cTrim === displayName) continue;
        // 跳过纯电话号码 (= 标题)
        if (isPhoneLike(cTrim)) continue;
        // 跳过时间戳
        if (isTimeLike(cTrim)) continue;
        // 跳过状态片段
        if (isStatusText(cTrim)) continue;
        lastMsg = cTrim;
        break;
      }

      // 2026-04-28 · 去掉 30s 时间桶 · 同 row 不再被强制重 fire
      //   bug: 时间桶导致每 30s 同未读 row 又 fire · 后端 8s 聚合 timer 永远被 reset
      //   现: dedupeKey = (rowId or text) + lastMsg + unread
      //   user 真发新消息 → unread+1 → key 变 → 新 fire (依然能识别新消息)
      //   user 一直没读 → unread 不变 → key 不变 → 60s 窗内不重 fire
      const rowKeyBase = rowDataId ?? text.slice(0, 50);
      const dedupeKey = `${rowKeyBase}|${lastMsg ?? ''}|${unread}`;

      return {
        preview: text.slice(0, 80),
        phoneE164: phone,
        lastMessagePreview: lastMsg,
        unreadCount: unread,
        detectedAt: Date.now(),
        dedupeKey,
        identitySource,
        displayName,
        rowDataId, // P0.11
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

    // 2026-04-28 · 5s poll 兜底 (即使 MutationObserver 没 attach 也兜得住)
    //   bug: WA Web 频繁改 DOM · selectors 失效 · MO 静默挂掉
    //   poll: 主动每 5s 扫所有 row · 命中 unread → 触发 cb (JS 侧 dedupe 处理重复)
    const pollScan = () => {
      try {
        const p = findPane();
        if (!p) return;
        const rows = p.querySelectorAll('[role="listitem"], div[data-testid*="cell"]');
        rows.forEach((row) => {
          const hint = extractHint(row);
          if (hint) {
            try {
              cb(hint);
            } catch {
              /* ignore */
            }
          }
        });
      } catch {
        /* ignore · poll 错误不致命 */
      }
    };
    const pollTimer = setInterval(pollScan, 5_000);

    // 把 observer + poll ref 暴露给 uninstall 用
    (window as unknown as {
      __wahubxObserver?: MutationObserver | null;
      __wahubxPollTimer?: ReturnType<typeof setInterval> | null;
    }).__wahubxObserver = observer;
    (window as unknown as {
      __wahubxObserver?: MutationObserver | null;
      __wahubxPollTimer?: ReturnType<typeof setInterval> | null;
    }).__wahubxPollTimer = pollTimer;
  }, callbackName);

  opts.log.info('D10 inbound watcher installed · MutationObserver on chat-list pane');

  const uninstall = async (): Promise<void> => {
    try {
      await page.evaluate(() => {
        const w = window as unknown as {
          __wahubxObserver?: MutationObserver | null;
          __wahubxPollTimer?: ReturnType<typeof setInterval> | null;
        };
        if (w.__wahubxObserver) {
          w.__wahubxObserver.disconnect();
          w.__wahubxObserver = null;
        }
        if (w.__wahubxPollTimer) {
          clearInterval(w.__wahubxPollTimer);
          w.__wahubxPollTimer = null;
        }
      });
    } catch {
      /* ignore */
    }
  };
  return { uninstall };
}
