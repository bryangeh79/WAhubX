// 2026-04-25 · 反爬可见性采样 (D4 第 3 件)
//
// 目标: 不大改 stealth · 先看 navigator/window 关键值真实情况 · 落证据 JSON.
// 用 D4 的法医发现 (Chrome 85+ 不支持 landing) 反推这里要采哪几项.

import type { Page } from 'puppeteer-core';

export interface AntiBotSignals {
  // navigator
  navigatorWebdriver: boolean | null | undefined;
  userAgent: string;
  userAgentDataBrands: Array<{ brand: string; version: string }> | null;
  platform: string;
  languages: string[];
  pluginsLength: number;
  hardwareConcurrency: number;
  // window
  hasChromeObject: boolean;
  chromeRuntimeKeys: string[];
  // permissions API (常被 stealth 检测)
  permissionsNotificationsState: string | null;
  permissionsNotificationsError: string | null;
  // screen / 视口
  screen: { width: number; height: number; colorDepth: number };
  innerWidth: number;
  innerHeight: number;
  // 时区 / locale
  timeZone: string;
  locale: string;
  // 一些常被检测的细节
  webglVendor: string | null;
  webglRenderer: string | null;
  // headless 信号
  uaIncludesHeadless: boolean;
  uaIncludesChrome: boolean;
  uaChromeVersion: string | null;
}

/**
 * 在 page 内一次性采全部 signals · 落 JSON
 */
export async function captureAntiBotSignals(page: Page): Promise<AntiBotSignals> {
  return page.evaluate(async (): Promise<AntiBotSignals> => {
    const ua = navigator.userAgent;
    const uaChromeMatch = ua.match(/Chrome\/(\d+(?:\.\d+)*)/);

    // userAgentData (UA Client Hints)
    const uad = (navigator as Navigator & {
      userAgentData?: { brands: Array<{ brand: string; version: string }> };
    }).userAgentData;
    const brands = uad?.brands ?? null;

    // chrome runtime
    const w = window as unknown as { chrome?: { runtime?: object } };
    const hasChrome = typeof w.chrome === 'object' && w.chrome !== null;
    const chromeRuntimeKeys = hasChrome && w.chrome
      ? Object.keys(w.chrome).slice(0, 15)
      : [];

    // permissions
    let permState: string | null = null;
    let permError: string | null = null;
    try {
      const result = await navigator.permissions.query({ name: 'notifications' as PermissionName });
      permState = result.state;
    } catch (e) {
      permError = e instanceof Error ? e.message : String(e);
    }

    // webgl
    let webglVendor: string | null = null;
    let webglRenderer: string | null = null;
    try {
      const canvas = document.createElement('canvas');
      const gl = (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
      if (gl) {
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          webglVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) as string;
          webglRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string;
        }
      }
    } catch { /* ignore */ }

    return {
      navigatorWebdriver: navigator.webdriver,
      userAgent: ua,
      userAgentDataBrands: brands,
      platform: navigator.platform,
      languages: Array.from(navigator.languages),
      pluginsLength: navigator.plugins.length,
      hardwareConcurrency: navigator.hardwareConcurrency,
      hasChromeObject: hasChrome,
      chromeRuntimeKeys,
      permissionsNotificationsState: permState,
      permissionsNotificationsError: permError,
      screen: {
        width: screen.width,
        height: screen.height,
        colorDepth: screen.colorDepth,
      },
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: navigator.language,
      webglVendor,
      webglRenderer,
      uaIncludesHeadless: /HeadlessChrome|Headless/i.test(ua),
      uaIncludesChrome: /Chrome\//.test(ua),
      uaChromeVersion: uaChromeMatch?.[1] ?? null,
    };
  });
}
