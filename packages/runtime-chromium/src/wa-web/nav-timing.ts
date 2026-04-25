// 2026-04-25 · WA Web 导航阶段计时收集
//
// 目的: D3 结束后能区分卡点是
//   - 代理网络慢 (firstByte 长)
//   - WS 拦 (DOMContentLoaded 后无后续)
//   - 资源加载不全 (idle 久不来)
//   - WA Web 自身卡 splash (进了 DOMContentLoaded · 久不渲 qr/chat-list)

import type { Page } from 'puppeteer-core';

export interface NavTimings {
  gotoStart: number;
  firstByteAt: number | null;          // 首个 WA Web URL 响应包到 (response listener)
  domContentLoadedAt: number | null;   // page.once('domcontentloaded')
  loadAt: number | null;               // page.once('load')
  networkIdleAt: number | null;        // page.goto waitUntil:networkidle2 完成 (或 null = timeout)
  networkIdleTimedOut: boolean;
  stateDetectedAt: number | null;      // qr/chat-list 命中
  // 计算字段
  firstByteMs: number | null;
  domContentLoadedMs: number | null;
  loadMs: number | null;
  networkIdleMs: number | null;
  stateDetectedMs: number | null;
}

/**
 * 在 page.goto 前调用 attachNavTimings · 注册事件 listener.
 * 返回 readonly snapshot 函数 + setter.
 */
export interface NavTimingsTracker {
  markGoto(): void;
  markNetworkIdle(): void;
  markNetworkIdleTimeout(): void;
  markStateDetected(): void;
  snapshot(): NavTimings;
}

export function createNavTimingsTracker(page: Page, urlPrefix: string): NavTimingsTracker {
  const t: NavTimings = {
    gotoStart: 0,
    firstByteAt: null,
    domContentLoadedAt: null,
    loadAt: null,
    networkIdleAt: null,
    networkIdleTimedOut: false,
    stateDetectedAt: null,
    firstByteMs: null,
    domContentLoadedMs: null,
    loadMs: null,
    networkIdleMs: null,
    stateDetectedMs: null,
  };

  // first byte: 第一个 url 以 prefix 开头的 response 到达
  const onResponse = (resp: { url(): string }) => {
    if (t.firstByteAt === null && resp.url().startsWith(urlPrefix)) {
      t.firstByteAt = Date.now();
    }
  };
  page.on('response', onResponse);

  page.once('domcontentloaded', () => {
    t.domContentLoadedAt = Date.now();
  });
  page.once('load', () => {
    t.loadAt = Date.now();
  });

  function compute() {
    t.firstByteMs = t.firstByteAt && t.gotoStart ? t.firstByteAt - t.gotoStart : null;
    t.domContentLoadedMs = t.domContentLoadedAt && t.gotoStart ? t.domContentLoadedAt - t.gotoStart : null;
    t.loadMs = t.loadAt && t.gotoStart ? t.loadAt - t.gotoStart : null;
    t.networkIdleMs = t.networkIdleAt && t.gotoStart ? t.networkIdleAt - t.gotoStart : null;
    t.stateDetectedMs = t.stateDetectedAt && t.gotoStart ? t.stateDetectedAt - t.gotoStart : null;
  }

  return {
    markGoto() {
      t.gotoStart = Date.now();
    },
    markNetworkIdle() {
      t.networkIdleAt = Date.now();
    },
    markNetworkIdleTimeout() {
      t.networkIdleTimedOut = true;
      t.networkIdleAt = Date.now();
    },
    markStateDetected() {
      t.stateDetectedAt = Date.now();
    },
    snapshot() {
      compute();
      return { ...t };
    },
  };
}
