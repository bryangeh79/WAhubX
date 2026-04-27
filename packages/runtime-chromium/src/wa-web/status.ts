// 2026-04-26 · D11 · WA Status (动态/Story) 自动化 actions
//
// 范围:
//   ✓ postStatusText(page, text)            · 发文字 status
//   ✓ postStatusMedia(page, base64, kind)   · 发图/视频 status
//   ✓ browseStatuses(page, max, dwellMs)    · 浏览未读他人 status
//   ✓ reactStatuses(page, max, emoji)       · 给前 N 条 status 点赞
//
// ⚠ 选择器未实测 · 上线前需 chromium devtools 用真号校准 · 写多 fallback 抗 WA Web 漂移
//
// 路径假设 (基于 WA Web 公开 DOM 结构):
//   - 左侧栏有 Status tab (icon)
//   - 点 status tab → 主 pane 显示 "我的 status" + "最近更新" 列表
//   - 点列表项 → 进 status viewer (全屏覆盖) · 5s 自动播下一条 / 手动滑
//   - viewer 内底部有 reply 输入框 (输入文本 = reply 给 author)
//   - viewer 内有 emoji react 按钮 (类似 IG stories)
//   - 点头像 (左上) → 个人资料 pane → "关于" 行 → 进编辑

import type { Page, ElementHandle } from 'puppeteer-core';
import type { Logger } from 'pino';
import { WA_SELECTORS } from './wa-web-selectors';
import { captureEvidence } from './screenshot-evidence';

// ── 共用 helper (复刻 actions.ts 模式 · per-call 2s cap) ──
async function waitForAnySelector(
  page: Page,
  selectors: string[],
  timeoutMs: number,
  pollMs = 500,
  perCallMs = 2_000,
): Promise<ElementHandle | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const sel of selectors) {
      const remaining = timeoutMs - (Date.now() - start);
      if (remaining <= 0) return null;
      const callCap = Math.min(perCallMs, remaining);
      try {
        const el = await Promise.race<ElementHandle | null>([
          page.$(sel),
          new Promise<null>((res) => setTimeout(() => res(null), callCap)),
        ]);
        if (el) return el;
      } catch {
        /* try next */
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}

// ═══ 1. openStatusTab · 共享前置 ═══════════════════════════════════════

/**
 * 切到 Status tab (左侧栏). 返回 ok=true 表示已进入 status 视图.
 * 多次调用安全 (已在 status tab 时 click 同按钮 noop).
 */
async function openStatusTab(page: Page, log: Logger): Promise<boolean> {
  const tabEl = await waitForAnySelector(page, WA_SELECTORS.statusTabButton, 8_000);
  if (!tabEl) {
    log.warn('D11 status tab button not found');
    return false;
  }
  try {
    await tabEl.click({ delay: 80 });
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, 'status tab click failed');
    await tabEl.dispose();
    return false;
  }
  await tabEl.dispose();
  // 等列表渲染
  await new Promise((r) => setTimeout(r, 1500));
  return true;
}

// ═══ 2. postStatusText ════════════════════════════════════════════════

export interface PostStatusResult {
  ok: boolean;
  pseudoMessageId: string | null;
  error?: string;
  durationMs: number;
}

export async function postStatusText(
  page: Page,
  text: string,
  log: Logger,
  diagnosticsDir?: string,
): Promise<PostStatusResult> {
  const startedAt = Date.now();
  if (!(await openStatusTab(page, log))) {
    if (diagnosticsDir) await captureEvidence(page, diagnosticsDir, 'd11-status-tab-miss').catch(() => {});
    return { ok: false, pseudoMessageId: null, error: 'status tab not found', durationMs: Date.now() - startedAt };
  }

  // 点 "添加 status" / "我的 status" → 进文字编辑
  // 一些版本要先点 my-status 再选 "Text"; 一些直接 ➕ 出选择器
  const addEl =
    (await waitForAnySelector(page, WA_SELECTORS.addStatusButton, 4_000)) ??
    (await waitForAnySelector(page, WA_SELECTORS.myStatusItem, 3_000));
  if (!addEl) {
    if (diagnosticsDir) await captureEvidence(page, diagnosticsDir, 'd11-add-status-miss').catch(() => {});
    return { ok: false, pseudoMessageId: null, error: 'add-status button not found', durationMs: Date.now() - startedAt };
  }
  try {
    await addEl.click({ delay: 80 });
  } catch {
    /* ignore · 继续 */
  }
  await addEl.dispose();
  await new Promise((r) => setTimeout(r, 1200));

  // 找文字输入框 · contenteditable
  const inputEl = await waitForAnySelector(page, WA_SELECTORS.statusTextInput, 6_000);
  if (!inputEl) {
    if (diagnosticsDir) await captureEvidence(page, diagnosticsDir, 'd11-status-text-input-miss').catch(() => {});
    return {
      ok: false,
      pseudoMessageId: null,
      error: 'status text input not found',
      durationMs: Date.now() - startedAt,
    };
  }
  try {
    await inputEl.click({ delay: 50 });
  } catch {
    /* ignore */
  }
  await inputEl.dispose();
  await new Promise((r) => setTimeout(r, 250));

  // 输入文本 (慢点 · 模拟人)
  try {
    await page.keyboard.type(text, { delay: 30 + Math.floor(Math.random() * 30) });
  } catch (err) {
    return {
      ok: false,
      pseudoMessageId: null,
      error: `type failed: ${err instanceof Error ? err.message : err}`,
      durationMs: Date.now() - startedAt,
    };
  }
  await new Promise((r) => setTimeout(r, 400));

  // 点发送
  const sendEl = await waitForAnySelector(page, WA_SELECTORS.statusSendButton, 3_000);
  if (sendEl) {
    try {
      await sendEl.click({ delay: 50 });
    } catch {
      /* ignore */
    }
    await sendEl.dispose();
  } else {
    // fallback: 按 Enter
    log.warn('status send button not found · 用 Enter 兜底');
    try {
      await page.keyboard.press('Enter');
    } catch {
      /* ignore */
    }
  }

  // 等弹回 status 列表 (没有可靠的"已发"信号 · 等 1.5s 后认成功)
  await new Promise((r) => setTimeout(r, 1500));
  const pseudoMessageId = `status-text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  log.info({ pseudoMessageId, len: text.length }, 'D11 postStatusText · 发送已触发 (unconfirmed)');
  return { ok: true, pseudoMessageId, durationMs: Date.now() - startedAt };
}

// ═══ 3. postStatusMedia (图/视频) ══════════════════════════════════════

export async function postStatusMedia(
  page: Page,
  base64: string,
  kind: 'image' | 'video',
  options: { caption?: string; fileName?: string; diagnosticsDir?: string },
  log: Logger,
): Promise<PostStatusResult> {
  const startedAt = Date.now();
  if (!(await openStatusTab(page, log))) {
    return { ok: false, pseudoMessageId: null, error: 'status tab not found', durationMs: Date.now() - startedAt };
  }

  // 把 base64 写到临时文件
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const tmpDir = '/tmp/wahubx-status';
  await fs.mkdir(tmpDir, { recursive: true });
  const ext = kind === 'image' ? '.jpg' : '.mp4';
  const fileName = options.fileName ?? `status${ext}`;
  const tmpPath = path.join(tmpDir, `${Date.now()}-${fileName}`);
  const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, '');
  await fs.writeFile(tmpPath, Buffer.from(cleanBase64, 'base64'));

  // 点 "我的 status" 触发 file chooser (WA Web 的"添加 status" 通常直接弹文件选)
  const addEl =
    (await waitForAnySelector(page, WA_SELECTORS.myStatusItem, 4_000)) ??
    (await waitForAnySelector(page, WA_SELECTORS.addStatusButton, 3_000));
  if (!addEl) {
    if (options.diagnosticsDir) await captureEvidence(page, options.diagnosticsDir, 'd11-status-add-miss').catch(() => {});
    return { ok: false, pseudoMessageId: null, error: 'add-status button not found', durationMs: Date.now() - startedAt };
  }

  // click 同时 wait file chooser (跟 actions.ts file 路径一致)
  let chooserAccepted = false;
  try {
    const [chooser] = await Promise.all([
      page.waitForFileChooser({ timeout: 8_000 }),
      addEl.click({ delay: 80 }),
    ]);
    await chooser.accept([tmpPath]);
    chooserAccepted = true;
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : err },
      'fileChooser path failed · 可能不是直接弹 chooser · 看是否要二级选择',
    );
  }
  await addEl.dispose();

  if (!chooserAccepted) {
    if (options.diagnosticsDir) await captureEvidence(page, options.diagnosticsDir, 'd11-status-media-fail').catch(() => {});
    fs.unlink(tmpPath).catch(() => {});
    return { ok: false, pseudoMessageId: null, error: 'media file injection failed', durationMs: Date.now() - startedAt };
  }

  // 等 preview pane
  await new Promise((r) => setTimeout(r, 2000));

  // caption 可选
  if (options.caption) {
    try {
      await page.keyboard.type(options.caption, { delay: 30 });
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  // 点发送
  const sendEl = await waitForAnySelector(page, WA_SELECTORS.statusSendButton, 4_000);
  if (sendEl) {
    try {
      await sendEl.click({ delay: 50 });
    } catch {
      /* ignore */
    }
    await sendEl.dispose();
  } else {
    try {
      await page.keyboard.press('Enter');
    } catch {
      /* ignore */
    }
  }

  await new Promise((r) => setTimeout(r, 2000));
  fs.unlink(tmpPath).catch(() => {});
  const pseudoMessageId = `status-media-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  log.info({ pseudoMessageId, kind }, 'D11 postStatusMedia · 发送已触发 (unconfirmed)');
  return { ok: true, pseudoMessageId, durationMs: Date.now() - startedAt };
}

// ═══ 4. browseStatuses (浏览他人 status) ═══════════════════════════════

export interface BrowseStatusResult {
  ok: boolean;
  viewed: number;
  durationMs: number;
  error?: string;
}

export async function browseStatuses(
  page: Page,
  options: { maxItems: number; dwellMs: number; diagnosticsDir?: string },
  log: Logger,
): Promise<BrowseStatusResult> {
  const startedAt = Date.now();
  const maxItems = Math.min(options.maxItems, 50);
  const dwellMs = Math.max(options.dwellMs, 1500);

  if (!(await openStatusTab(page, log))) {
    return { ok: false, viewed: 0, error: 'status tab not found', durationMs: Date.now() - startedAt };
  }

  // 找 status 列表项 (取前 maxItems 个 · 点击 → dwell → 关闭 → 下一个)
  // 注: WA Web status viewer 自动播下一条, 所以理论上点第一个能连续看完整队列.
  //     但保守做法: 每条单独点 · 控制 dwell 时长.
  let viewed = 0;
  for (let i = 0; i < maxItems; i++) {
    // 重新 query · WA Web DOM 在 viewer 关闭后会重排
    const items = await page.$$(WA_SELECTORS.statusListItem.join(','));
    if (!items.length) {
      log.info({ viewed, i }, 'D11 browseStatuses · no more items');
      break;
    }
    const item = items[Math.min(i, items.length - 1)]; // 安全索引
    try {
      await item.click({ delay: 80 });
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : err, i }, 'status item click failed · 跳');
      // 释放剩余 handles
      for (const h of items) await h.dispose();
      continue;
    }
    // 释放 handles
    for (const h of items) await h.dispose();

    // 等 viewer 进入并停留 dwellMs (WA 自动 mark as viewed)
    await new Promise((r) => setTimeout(r, dwellMs));
    viewed++;

    // 关 viewer (按 Esc · 兼容性最好)
    try {
      await page.keyboard.press('Escape');
    } catch {
      /* ignore */
    }
    // 备选: 直接点 X
    const closeEl = await waitForAnySelector(page, WA_SELECTORS.statusViewerCloseButton, 1_500);
    if (closeEl) {
      try {
        await closeEl.click({ delay: 30 });
      } catch {
        /* ignore */
      }
      await closeEl.dispose();
    }
    await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));
  }

  log.info({ viewed, durationMs: Date.now() - startedAt }, 'D11 browseStatuses · done');
  return { ok: true, viewed, durationMs: Date.now() - startedAt };
}

// ═══ 5. reactStatuses (给 N 条 status 点赞) ════════════════════════════

export interface ReactStatusResult {
  ok: boolean;
  reacted: number;
  durationMs: number;
  error?: string;
}

export async function reactStatuses(
  page: Page,
  options: { maxItems: number; emoji: string; diagnosticsDir?: string },
  log: Logger,
): Promise<ReactStatusResult> {
  const startedAt = Date.now();
  const maxItems = Math.min(options.maxItems, 5); // 硬上限 5 防风控

  if (!(await openStatusTab(page, log))) {
    return { ok: false, reacted: 0, error: 'status tab not found', durationMs: Date.now() - startedAt };
  }

  let reacted = 0;
  for (let i = 0; i < maxItems; i++) {
    const items = await page.$$(WA_SELECTORS.statusListItem.join(','));
    if (!items.length) break;
    const item = items[Math.min(i, items.length - 1)];
    try {
      await item.click({ delay: 80 });
    } catch {
      for (const h of items) await h.dispose();
      continue;
    }
    for (const h of items) await h.dispose();

    // 等 viewer 进入
    await new Promise((r) => setTimeout(r, 1500));

    // 找 react 按钮
    const reactBtn = await waitForAnySelector(page, WA_SELECTORS.statusReactButton, 3_000);
    if (!reactBtn) {
      // 没找到 react 按钮 · 用 reply input 输入 emoji 兜底 (WA reply 也是一种"互动")
      log.warn({ i }, 'react button not found · 用 reply input 兜底输入 emoji');
      const replyEl = await waitForAnySelector(page, WA_SELECTORS.statusReplyInput, 2_000);
      if (replyEl) {
        try {
          await replyEl.click({ delay: 30 });
          await replyEl.dispose();
          await page.keyboard.type(options.emoji, { delay: 50 });
          await new Promise((r) => setTimeout(r, 300));
          await page.keyboard.press('Enter');
          reacted++;
        } catch (err) {
          log.warn({ err: err instanceof Error ? err.message : err }, 'reply emoji failed');
        }
      }
    } else {
      try {
        await reactBtn.click({ delay: 50 });
        await reactBtn.dispose();
        await new Promise((r) => setTimeout(r, 800));
        // 找 emoji picker 里的 thumbs up (默认 emoji)
        const emojiEl = await waitForAnySelector(page, WA_SELECTORS.emojiThumbsUp, 2_500);
        if (emojiEl) {
          try {
            await emojiEl.click({ delay: 30 });
          } catch {
            /* ignore */
          }
          await emojiEl.dispose();
          reacted++;
        } else {
          log.warn({ i }, 'emoji thumbs-up not found in picker');
        }
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.message : err }, 'react flow failed');
      }
    }

    // 关 viewer
    try {
      await page.keyboard.press('Escape');
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 800 + Math.random() * 600));
  }

  log.info({ reacted, durationMs: Date.now() - startedAt }, 'D11 reactStatuses · done');
  return { ok: true, reacted, durationMs: Date.now() - startedAt };
}
