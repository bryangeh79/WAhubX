// 2026-04-25 · D6 · 实时 QR HTTP server (9701)
//
// 用途: WA Web QR 跟当下 WS session 强绑 · 静态 PNG 扫不上 ·
// host 浏览器开 http://localhost:9701/ 看 HTML 页 · 内嵌 <img>
// 每 2s 重提 page canvas · 用户手机扫电脑屏幕 = 真活 QR.
//
// 不在范围:
//   - WS bridge (D7+)
//   - 验证逻辑 (D7+)

import * as http from 'node:http';
import type { Page } from 'puppeteer-core';
import type { Logger } from 'pino';
import { findFirstMatch, WA_SELECTORS } from './wa-web/wa-web-selectors';

export interface QrLiveServerOptions {
  page: Page;
  port: number;
  log: Logger;
}

const HTML_PAGE = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>WA QR Live · WAhubX SaaS Runtime</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #111; color: #eee;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 100vh; margin: 0; padding: 20px; }
  h1 { margin: 0 0 8px; font-size: 18px; color: #25d366; }
  .hint { font-size: 13px; color: #888; margin-bottom: 16px; }
  .qr-box { background: #fff; padding: 16px; border-radius: 8px; }
  .qr-box img { display: block; width: 280px; height: 280px; }
  .meta { margin-top: 12px; font-size: 11px; color: #555; font-family: monospace; }
</style>
</head>
<body>
<h1>WA Web · 活 QR (容器内 chromium 实时画布)</h1>
<div class="hint">手机 WA → 设置 → 已链接的设备 → 链接设备 → 扫这个屏</div>
<div class="qr-box"><img id="qr" src="/qr.png?t=0"></div>
<div class="meta" id="meta">refreshing every 2s</div>
<script>
let n = 0;
setInterval(() => {
  n++;
  document.getElementById('qr').src = '/qr.png?t=' + Date.now();
  document.getElementById('meta').textContent = 'refresh #' + n + ' · ' + new Date().toLocaleTimeString();
}, 2000);
</script>
</body>
</html>`;

export function startQrLiveServer(opts: QrLiveServerOptions): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/' || req.url?.startsWith('/index')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HTML_PAGE);
      return;
    }
    if (req.url?.startsWith('/qr.png')) {
      try {
        const dataUrl = await opts.page.evaluate((selectors: string[]) => {
          for (const sel of selectors) {
            const canvas = document.querySelector(sel) as HTMLCanvasElement | null;
            if (canvas) return canvas.toDataURL('image/png');
          }
          return null;
        }, WA_SELECTORS.qrCanvas);

        if (!dataUrl) {
          // 不在 qr 状态 · 返 204
          res.writeHead(204);
          res.end();
          return;
        }
        const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
        const buf = Buffer.from(base64, 'base64');
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Cache-Control': 'no-store',
          'Content-Length': String(buf.length),
        });
        res.end(buf);
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('error: ' + (err instanceof Error ? err.message : String(err)));
      }
      return;
    }
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ts: Date.now() }));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  // 2026-04-26 · multi-slot 防御 · listen 失败 (EADDRINUSE) 只 warn · 不抛 uncaughtException
  // QR live server 是辅助调试工具 · 真 QR 走 WS 桥 → backend → frontend BindExistingModal
  // 端口冲突时静默放弃 · 不影响 bind 主链路
  server.on('error', (err) => {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EADDRINUSE') {
      opts.log.warn(
        { port: opts.port, code },
        'QR live server 端口被占 · 跳过启动 (不影响 bind 主链路 · 真 QR 走 WS)',
      );
      return;
    }
    opts.log.error({ port: opts.port, err: err.message }, 'QR live server 失败 · 跳过启动');
  });

  server.listen(opts.port, '0.0.0.0', () => {
    opts.log.info({ port: opts.port }, 'QR live server listening · open http://localhost:' + opts.port + '/ on host');
  });

  return server;
}
