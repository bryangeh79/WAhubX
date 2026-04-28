// 2026-04-25 · runtime 启动期 screenshot/HTML/url 证据收集
//
// 用途:
//   - selector 失效 · debug 之前先看证据
//   - WA Web 升级导致 DOM 变 · 截图比错误日志直观
//   - POC 验收时录档 (C1/C2/C6 都需要 page screenshot 证据)
//
// 落盘到: ${SESSION_DIR}/diagnostics/<timestamp>-<stage>.{png,html,txt}

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Page } from 'puppeteer-core';

export interface EvidenceShot {
  stage: string;             // 'launch-blank' / 'wa-web-loaded' / 'state-detected'
  timestamp: string;         // ISO
  url: string;
  title: string;
  pngPath: string | null;
  htmlPath: string | null;
  metaPath: string;
}

/**
 * 截一组证据 (3 文件):
 *   - {stage}.png       全屏截图
 *   - {stage}.html      DOM outerHTML (前 50KB · 防大文件)
 *   - {stage}.meta.json url + title + ts + viewport
 *
 * 失败不阻断 (debug 用 · 不能因截图失败拖死主流程)
 */
export async function captureEvidence(
  page: Page,
  diagnosticsDir: string,
  stage: string,
): Promise<EvidenceShot> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = `${ts}-${stage}`;
  const meta: EvidenceShot = {
    stage,
    timestamp: new Date().toISOString(),
    url: page.url(),
    title: '',
    pngPath: null,
    htmlPath: null,
    metaPath: path.join(diagnosticsDir, `${baseName}.meta.json`),
  };

  await fs.mkdir(diagnosticsDir, { recursive: true }).catch(() => {});

  // title (5s 超时 · 防 hang)
  try {
    meta.title = await Promise.race<string>([
      page.title(),
      new Promise((_, rj) => setTimeout(() => rj(new Error('title timeout')), 5_000)),
    ]);
  } catch {
    meta.title = '<title-fetch-failed>';
  }

  // PNG screenshot
  try {
    const pngPath = path.join(diagnosticsDir, `${baseName}.png`);
    await page.screenshot({ path: pngPath as `${string}.png`, fullPage: false, captureBeyondViewport: false, type: 'png' });
    meta.pngPath = pngPath;
  } catch (err) {
    // ignore · 写到 meta 里
    (meta as unknown as Record<string, string>).pngError = err instanceof Error ? err.message : String(err);
  }

  // HTML snippet (前 50KB · 防 WA Web DOM 太大)
  try {
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    const truncated = html.length > 50_000 ? html.slice(0, 50_000) + '\n<!-- TRUNCATED -->' : html;
    const htmlPath = path.join(diagnosticsDir, `${baseName}.html`);
    await fs.writeFile(htmlPath, truncated, 'utf-8');
    meta.htmlPath = htmlPath;
  } catch (err) {
    (meta as unknown as Record<string, string>).htmlError = err instanceof Error ? err.message : String(err);
  }

  // meta.json (写最后 · 包前面写好的 path)
  try {
    await fs.writeFile(meta.metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  } catch {
    // ignore
  }

  return meta;
}
