// 2026-04-25 · WA Web DOM 法医分析
//
// 目的: 不猜 selector · 直接读真实 DOM · 提稳定锚点 + 检测特殊 landing 页.
// 用法: 在 state=unknown 时跑 · 或定期跑作为采样.

import type { Page } from 'puppeteer-core';

export interface DomForensicsReport {
  url: string;
  title: string;
  htmlLength: number;
  // 通用稳定锚点 (按优先级)
  anchors: {
    dataTestids: string[];   // [data-testid="..."] 值列表
    ariaLabels: string[];    // [aria-label="..."] 值列表
    roles: string[];         // [role="..."] 值列表
    dataIcons: string[];     // [data-icon="..."] (WA 自定义)
    dataRefs: string[];      // [data-ref] (WA QR 容器常用)
  };
  // 特殊 DOM 信号 (识别 WA 拒绝/降级页)
  unsupportedLanding: {
    detected: boolean;       // 见到 landing-wrapper / landing-header 等关键 class
    indicators: string[];    // 命中的关键 class 名
    visibleText: string | null;  // 页面主要文字 (e.g. "Update Google Chrome")
  };
  splashIndicators: {
    detected: boolean;
    indicators: string[];    // splash CSS vars / class
  };
  qrCanvasPresent: boolean;
  chatListPresent: boolean;
  // 主体结构概览 (便于 selector 选择参考)
  bodyChildrenSummary: Array<{ tag: string; id?: string; classes: string[] }>;
}

/**
 * 在 page 上执行 DOM 采样. 不修改 selector · 不影响主流程.
 */
export async function runDomForensics(page: Page): Promise<DomForensicsReport> {
  // 全部用 page.evaluate 一次完成 · 减少 IPC 来回
  return page.evaluate(() => {
    const truncate = (s: string | null | undefined, n = 100) =>
      s ? (s.length > n ? s.slice(0, n) + '…' : s) : '';

    const collectAttr = (attr: string): string[] => {
      const els = document.querySelectorAll(`[${attr}]`);
      const vals: string[] = [];
      els.forEach((el) => {
        const v = el.getAttribute(attr);
        if (v) vals.push(v);
      });
      return Array.from(new Set(vals)).slice(0, 50);
    };

    // unsupported landing 检测
    const landingClassFragments = [
      'landing-wrapper',
      'landing-header',
      'landing-headerTitle',
      'landing-main',
      'landing-window',
      'window-body',
      'version-title',
    ];
    const indicators: string[] = [];
    landingClassFragments.forEach((frag) => {
      if (document.querySelector(`[class*="${frag}"]`)) indicators.push(frag);
    });
    let visibleText: string | null = null;
    if (indicators.length >= 2) {
      // 读 landing-title / landing-headerTitle 等含文字的元素
      const titleEl =
        document.querySelector('[class*="version-title"]') ||
        document.querySelector('[class*="landing-headerTitle"]') ||
        document.querySelector('[class*="landing-title"]');
      visibleText = truncate(titleEl?.textContent?.trim() ?? null, 200);
    }

    // splash 检测
    const splashIndicators: string[] = [];
    const rootStyle = document.documentElement.getAttribute('style') || '';
    if (rootStyle.includes('--splashscreen-')) splashIndicators.push('--splashscreen-css-var');
    if (document.querySelector('[class*="splash"]')) splashIndicators.push('class*="splash"');
    if (document.querySelector('[data-testid*="intro-md-beta-logo"]')) {
      splashIndicators.push('intro-md-beta-logo testid');
    }

    // 结构概览 (body 直系子元素)
    const bodyChildren: Array<{ tag: string; id?: string; classes: string[] }> = [];
    const bodyRoot = document.body?.firstElementChild;
    if (bodyRoot) {
      const visit = (el: Element, depth = 0) => {
        if (depth > 4) return;
        bodyChildren.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || undefined,
          classes: Array.from(el.classList).slice(0, 6),
        });
        Array.from(el.children).slice(0, 5).forEach((c) => visit(c, depth + 1));
      };
      visit(bodyRoot);
    }

    return {
      url: location.href,
      title: document.title,
      htmlLength: document.documentElement.outerHTML.length,
      anchors: {
        dataTestids: collectAttr('data-testid'),
        ariaLabels: collectAttr('aria-label'),
        roles: collectAttr('role'),
        dataIcons: collectAttr('data-icon'),
        dataRefs: collectAttr('data-ref'),
      },
      unsupportedLanding: {
        detected: indicators.length >= 2, // 至少 2 个关键 class 命中才算
        indicators,
        visibleText,
      },
      splashIndicators: {
        detected: splashIndicators.length > 0,
        indicators: splashIndicators,
      },
      qrCanvasPresent: !!document.querySelector('canvas[aria-label*="Scan"]')
        || !!document.querySelector('div[data-ref] canvas'),
      chatListPresent: !!document.querySelector('[data-testid="chat-list"]')
        || !!document.querySelector('#pane-side'),
      bodyChildrenSummary: bodyChildren.slice(0, 30),
    };
  });
}
