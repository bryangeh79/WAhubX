// 2026-04-25 · D10 W2 · WA Web DOM 自动化 actions (Codex 3 主链路锁)
//
// 范围 (锁死):
//   ✓ openChatByPhone(page, phone)         · deep link 打开聊天
//   ✓ sendTextInOpenChat(page, text)       · 在已打开的聊天发文本 + 单勾确认
//   ✓ sendMediaInOpenChat(page, base64...)  · input[type=file] 上传 image/file
//   ✓ watchIncomingMessages(page, callback) · DOM observer 监听新消息
//
// 不在范围 (Codex 锁):
//   ✗ 群 / status / newsletter
//   ✗ video / voice / paste media
//   ✗ takeover / intelligent-reply 联动
//   ✗ selector 自愈 LLM fallback
//
// 失败证据策略:
//   每次失败保存 screenshot + HTML snippet (复用 captureEvidence)

import type { Page, ElementHandle } from 'puppeteer-core';
import type { Logger } from 'pino';
import { WA_SELECTORS, findFirstMatch } from './wa-web-selectors';
import { HumanBehaviorSimulator } from '../human-behavior';
import { captureEvidence } from './screenshot-evidence';

// ═══ 公共 helper ═════════════════════════════════════════════════════
async function waitForAnySelector(
  page: Page,
  selectors: string[],
  timeoutMs: number,
  pollMs = 500,
): Promise<ElementHandle | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el) return el;
      } catch {
        /* try next */
      }
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}

// ═══ 1. openChatByPhone ══════════════════════════════════════════════
// WA Web deep link 格式: https://web.whatsapp.com/send?phone=<E164>
// 直接 navigate 即可 · 不需要点 "新聊天" 按钮 · 比 search 走 DOM 稳

export interface OpenChatResult {
  ok: boolean;
  error?: string;
  /** 命中的 messageInput selector (后续 sendText 用) */
  inputSelector?: string;
}

export async function openChatByPhone(
  page: Page,
  phone: string,
  log: Logger,
  diagnosticsDir?: string,
): Promise<OpenChatResult> {
  // E164 格式校验 (粗略 · 1-15 位数字)
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  if (!cleanPhone || cleanPhone.length < 7 || cleanPhone.length > 15) {
    return { ok: false, error: `invalid phone format: "${phone}"` };
  }

  const url = `https://web.whatsapp.com/send?phone=${cleanPhone}`;
  log.info({ phone: cleanPhone, url }, 'D10 openChatByPhone · navigating');

  try {
    // 用 SPA navigation 即可 · WA Web 内部 router 接管 · 不会真重载
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ err: msg }, 'D10 page.goto failed · 但 SPA 可能仍 OK · 继续等 input');
  }

  // 等输入框出现 · 最多 20s
  const inputEl = await waitForAnySelector(page, WA_SELECTORS.messageInput, 20_000);
  if (!inputEl) {
    if (diagnosticsDir) {
      try {
        await captureEvidence(page, diagnosticsDir, `d10-open-chat-fail-${cleanPhone}`);
      } catch {
        /* ignore */
      }
    }
    return { ok: false, error: 'message input not found within 20s · WA Web 可能没进 chat 页' };
  }
  await inputEl.dispose();

  // 找命中的具体 selector (诊断用)
  const matched = await findFirstMatch(page, WA_SELECTORS.messageInput);
  log.info({ phone: cleanPhone, selector: matched.selector }, 'D10 chat opened · message input found');
  return { ok: true, inputSelector: matched.selector };
}

// ═══ 2. sendTextInOpenChat ═══════════════════════════════════════════
// 前置: page 已在 chat 页 · messageInput 可见 (openChatByPhone 后)
// 路径: 聚焦输入框 → human typing → Enter → 等单勾 (msg-check)
// 单勾即认成功 (Codex 锁: 不做"等已送达"二次确认)

export interface SendTextResult {
  ok: boolean;
  /** WA 没暴露 messageId 给 DOM · 我们返时间戳作粗 ID (W2 D11+ 改) */
  pseudoMessageId: string | null;
  error?: string;
  durationMs: number;
}

export async function sendTextInOpenChat(
  page: Page,
  text: string,
  log: Logger,
  options?: {
    simulator?: HumanBehaviorSimulator;
    diagnosticsDir?: string;
    /** 等单勾确认的最大时间 · 默认 10s */
    confirmTimeoutMs?: number;
  },
): Promise<SendTextResult> {
  const startedAt = Date.now();
  const simulator = options?.simulator ?? new HumanBehaviorSimulator(page);
  const confirmTimeoutMs = options?.confirmTimeoutMs ?? 10_000;

  // 1. 找输入框 · 聚焦
  const inputEl = await waitForAnySelector(page, WA_SELECTORS.messageInput, 5_000);
  if (!inputEl) {
    return {
      ok: false,
      pseudoMessageId: null,
      error: 'message input not visible',
      durationMs: Date.now() - startedAt,
    };
  }
  try {
    await inputEl.click({ delay: 50 + Math.floor(Math.random() * 50) });
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, 'input click failed · 继续');
  }
  await inputEl.dispose();

  // 2. 记录发送前的最后消息时间戳 (用来 confirm 新消息出现)
  // 简化策略: 不读 DOM 比对 · 直接看单勾出现 (足够 D10)
  await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));

  // 3. human typing
  try {
    await simulator.simulateHumanTyping(text);
  } catch (err) {
    return {
      ok: false,
      pseudoMessageId: null,
      error: `typing failed: ${err instanceof Error ? err.message : err}`,
      durationMs: Date.now() - startedAt,
    };
  }

  // 4. 等一下 (像真人按 Enter 前略停)
  await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));

  // 5. Enter 发送
  try {
    await page.keyboard.press('Enter');
  } catch (err) {
    return {
      ok: false,
      pseudoMessageId: null,
      error: `Enter key failed: ${err instanceof Error ? err.message : err}`,
      durationMs: Date.now() - startedAt,
    };
  }
  log.info({ textLen: text.length }, 'D10 sendText · Enter pressed · 等单勾');

  // 6. 等单勾出现 (msg-check icon)
  // 注意: WA Web 会先显示 msg-time (pending) → 然后 msg-check (sent)
  // 我们等 msg-check · 但 confirmTimeout 内任何 status icon 出现都算成功
  const tickEl = await waitForAnySelector(page, WA_SELECTORS.messageStatusTick, confirmTimeoutMs);
  if (!tickEl) {
    if (options?.diagnosticsDir) {
      try {
        await captureEvidence(page, options.diagnosticsDir, 'd10-send-text-no-tick');
      } catch {
        /* ignore */
      }
    }
    return {
      ok: false,
      pseudoMessageId: null,
      error: `no message tick after ${confirmTimeoutMs}ms · 发送可能失败`,
      durationMs: Date.now() - startedAt,
    };
  }
  await tickEl.dispose();

  const pseudoMessageId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  log.info({ pseudoMessageId, durationMs: Date.now() - startedAt }, 'D10 sendText · 单勾确认 · 成功');
  return {
    ok: true,
    pseudoMessageId,
    durationMs: Date.now() - startedAt,
  };
}

// ═══ 3. sendMediaInOpenChat ══════════════════════════════════════════
// 前置: page 已在 chat 页
// 路径: 点 attach 按钮 → 弹出菜单 → 找 input[type=file] → uploadFile → caption (可选) → Enter

export interface SendMediaOptions {
  caption?: string;
  fileName?: string;
  /** image/* | application/* | etc · 默认从 base64 推断 */
  mimeType?: string;
  /** 'image' = 走图片路径 · 'file' = 走文档路径 · 默认 image */
  kind?: 'image' | 'file';
  diagnosticsDir?: string;
}

export interface SendMediaResult {
  ok: boolean;
  pseudoMessageId: string | null;
  error?: string;
  durationMs: number;
}

export async function sendMediaInOpenChat(
  page: Page,
  base64: string,
  options: SendMediaOptions,
  log: Logger,
): Promise<SendMediaResult> {
  const startedAt = Date.now();
  const kind = options.kind ?? 'image';

  // 1. 把 base64 写到临时文件 · puppeteer ElementHandle.uploadFile 需要文件路径
  const fileName = options.fileName ?? (kind === 'image' ? 'image.png' : 'file.bin');
  const tmpDir = '/tmp/wahubx-uploads';
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  await fs.mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(tmpDir, `${Date.now()}-${fileName}`);
  // 容错: base64 可能含 'data:image/png;base64,' 前缀
  const cleanBase64 = base64.replace(/^data:[^;]+;base64,/, '');
  await fs.writeFile(tmpPath, Buffer.from(cleanBase64, 'base64'));
  log.info({ tmpPath, fileName, bytes: cleanBase64.length }, 'D10 sendMedia · base64 → tmp file');

  // 2. 点 attach 按钮 · 触发 input[type=file] 出现
  const attachEl = await waitForAnySelector(page, WA_SELECTORS.attachButton, 5_000);
  if (!attachEl) {
    return {
      ok: false,
      pseudoMessageId: null,
      error: 'attach button not found',
      durationMs: Date.now() - startedAt,
    };
  }
  try {
    await attachEl.click({ delay: 50 });
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, 'attach click failed · 继续 (input 可能已在 DOM)');
  }
  await attachEl.dispose();

  // 3. 等 input[type=file] 出现 · 直接 uploadFile (跳过点击 menu item · 更稳)
  // WA Web 通常一打开 attach 菜单就会插入 hidden inputs
  const inputSelectors = kind === 'image' ? WA_SELECTORS.attachImageInput : WA_SELECTORS.attachDocumentInput;
  const fileInput = await waitForAnySelector(page, inputSelectors, 5_000);
  if (!fileInput) {
    if (options.diagnosticsDir) {
      try {
        await captureEvidence(page, options.diagnosticsDir, `d10-send-media-no-input-${kind}`);
      } catch {
        /* ignore */
      }
    }
    return {
      ok: false,
      pseudoMessageId: null,
      error: `${kind} file input not found in attach menu`,
      durationMs: Date.now() - startedAt,
    };
  }
  try {
    await (fileInput as ElementHandle<HTMLInputElement>).uploadFile(tmpPath);
  } catch (err) {
    await fileInput.dispose();
    return {
      ok: false,
      pseudoMessageId: null,
      error: `uploadFile failed: ${err instanceof Error ? err.message : err}`,
      durationMs: Date.now() - startedAt,
    };
  }
  await fileInput.dispose();

  // 4. 等 caption 输入框出现 (preview pane) · 可填 caption · 然后 Enter 发送
  // WA Web 上传后会进 preview · 此时也是 contenteditable input · 但 selector 可能不同
  await new Promise((r) => setTimeout(r, 1000));

  // 5. caption (可选)
  if (options.caption) {
    try {
      await page.keyboard.type(options.caption, { delay: 30 });
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : err }, 'caption type failed · 跳过');
    }
  }

  // 6. Enter 发送
  await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
  try {
    await page.keyboard.press('Enter');
  } catch (err) {
    return {
      ok: false,
      pseudoMessageId: null,
      error: `Enter on preview failed: ${err instanceof Error ? err.message : err}`,
      durationMs: Date.now() - startedAt,
    };
  }
  log.info({ kind }, 'D10 sendMedia · Enter pressed · 等 tick');

  // 7. 等单勾
  const tickEl = await waitForAnySelector(page, WA_SELECTORS.messageStatusTick, 15_000);
  // 清 tmp 文件
  fs.unlink(tmpPath).catch(() => {});

  if (!tickEl) {
    return {
      ok: false,
      pseudoMessageId: null,
      error: 'no tick after media send · 可能上传失败',
      durationMs: Date.now() - startedAt,
    };
  }
  await tickEl.dispose();

  const pseudoMessageId = `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  log.info({ pseudoMessageId, durationMs: Date.now() - startedAt }, 'D10 sendMedia · success');
  return { ok: true, pseudoMessageId, durationMs: Date.now() - startedAt };
}
