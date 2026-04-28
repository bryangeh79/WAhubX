// 2026-04-26 · D11 · WA 个人资料 (Profile) 编辑 actions
//
// 范围:
//   ✓ updateAbout(page, text)  · 改"关于"/签名
//
// ⚠ 选择器未实测 · 上线前需 chromium devtools 用真号校准
//
// 路径假设:
//   1. 点头像 (左上 header 区域) → 弹出 profile pane (左侧滑入)
//   2. profile pane 内有 "关于" / "About" 行 (clickable)
//   3. 点 "关于" → 内容区出现 contenteditable
//   4. 直接修改 contenteditable 内容 → 失焦自动保存 (WA Web 通常 onBlur save)
//   5. 关 profile pane 回主界面

import type { Page, ElementHandle } from 'puppeteer-core';
import type { Logger } from 'pino';
import { WA_SELECTORS } from './wa-web-selectors';
import { captureEvidence } from './screenshot-evidence';

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

export interface UpdateAboutResult {
  ok: boolean;
  error?: string;
  durationMs: number;
}

export async function updateAbout(
  page: Page,
  newText: string,
  log: Logger,
  diagnosticsDir?: string,
): Promise<UpdateAboutResult> {
  const startedAt = Date.now();
  // WA Web 对 about 长度上限 ~140 字符 · 防御性截断
  const safeText = newText.length > 139 ? newText.slice(0, 139) : newText;

  // 1. 点头像 → 打开 profile pane
  const avatarEl = await waitForAnySelector(page, WA_SELECTORS.selfProfileAvatar, 5_000);
  if (!avatarEl) {
    if (diagnosticsDir) await captureEvidence(page, diagnosticsDir, 'd11-profile-avatar-miss').catch(() => {});
    return { ok: false, error: 'self profile avatar not found', durationMs: Date.now() - startedAt };
  }
  try {
    await avatarEl.click({ delay: 80 });
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, 'avatar click failed');
    await avatarEl.dispose();
    return { ok: false, error: 'avatar click failed', durationMs: Date.now() - startedAt };
  }
  await avatarEl.dispose();
  await new Promise((r) => setTimeout(r, 1200));

  // 2. 点 "关于" 行 (打开编辑模式)
  const aboutRowEl = await waitForAnySelector(page, WA_SELECTORS.profileAboutRow, 4_000);
  if (!aboutRowEl) {
    // 一些版本 about 一直显示, 不需要点 row · 直接找 contenteditable
    log.warn('about row not clickable · 试找 contenteditable 直接编辑');
  } else {
    try {
      await aboutRowEl.click({ delay: 60 });
    } catch {
      /* ignore */
    }
    await aboutRowEl.dispose();
    await new Promise((r) => setTimeout(r, 600));
  }

  // 3. 找 contenteditable 输入框
  const inputEl = await waitForAnySelector(page, WA_SELECTORS.profileAboutInput, 4_000);
  if (!inputEl) {
    if (diagnosticsDir) await captureEvidence(page, diagnosticsDir, 'd11-profile-about-input-miss').catch(() => {});
    return { ok: false, error: 'about input not found', durationMs: Date.now() - startedAt };
  }

  // 4. 清空旧内容 (Ctrl+A 选全, 删除)
  try {
    await inputEl.click({ clickCount: 3, delay: 30 }); // 三击全选
  } catch {
    /* ignore */
  }
  await inputEl.dispose();
  await new Promise((r) => setTimeout(r, 200));
  try {
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await page.keyboard.press('Delete');
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 200));

  // 5. 输入新内容
  try {
    await page.keyboard.type(safeText, { delay: 25 + Math.floor(Math.random() * 25) });
  } catch (err) {
    return {
      ok: false,
      error: `type new about failed: ${err instanceof Error ? err.message : err}`,
      durationMs: Date.now() - startedAt,
    };
  }
  await new Promise((r) => setTimeout(r, 400));

  // 6. 触发保存 — WA Web 通常按 Enter 或 失焦 (Tab) 即保存
  try {
    await page.keyboard.press('Enter');
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 800));

  // 7. 关 profile pane (Esc 兼容性最好 / 点 X 按钮兜底)
  try {
    await page.keyboard.press('Escape');
  } catch {
    /* ignore */
  }
  const closeEl = await waitForAnySelector(page, WA_SELECTORS.profilePaneCloseButton, 1_500);
  if (closeEl) {
    try {
      await closeEl.click({ delay: 30 });
    } catch {
      /* ignore */
    }
    await closeEl.dispose();
  }

  log.info({ len: safeText.length, durationMs: Date.now() - startedAt }, 'D11 updateAbout · 已触发保存');
  return { ok: true, durationMs: Date.now() - startedAt };
}
