// 2026-04-25 · D7-2 · 深度 stealth 注入 (Codex 拍板 4 项范围 · 不扩)
//
// 范围 (Codex 锁定):
//   ① navigator.languages · 修 D7-3 遗留 q-值污染
//   ② Intl.DateTimeFormat.prototype.resolvedOptions · 跟 timezone/locale 保一致
//   ③ navigator.permissions.query · 只补 notifications / midi / push
//   ④ chrome.runtime · minimal stub (stealth plugin 删了 chrome · 真 Chrome 都有)
//
// 不在范围 (Codex 显式禁):
//   ❌ WebGL renderer 随机化
//   ❌ 行为模拟
//   ❌ UA/IP 国家一致性 (D7-3 已做)
//   ❌ WS bridge
//
// 注入位置: page.evaluateOnNewDocument · 每个新 document 创建前执行 ·
//          先于 WA Web 的 JS · 子 frame / iframe 也命中.

import type { Page } from 'puppeteer-core';
import type { Logger } from 'pino';
import type { CountryLocale } from './country-locale';

interface InjectParams {
  languages: string[];
  locale: string;
  timezone: string;
}

/**
 * 注入 4 项深度 stealth · 必须在 page.goto 之前调
 */
export async function injectStealthOverrides(
  page: Page,
  loc: CountryLocale,
  log: Logger,
): Promise<void> {
  const params: InjectParams = {
    languages: loc.languages,
    locale: loc.locale,
    timezone: loc.timezone,
  };

  await page.evaluateOnNewDocument((p: InjectParams) => {
    // ─── ① navigator.languages · 修 q-值污染 ───────────────────
    // CDP setUserAgentOverride.acceptLanguage 会让 navigator.languages 含 q-值
    // 真浏览器 navigator.languages = ['en-MY', 'en', 'ms'] · 不带 q
    try {
      Object.defineProperty(Object.getPrototypeOf(navigator), 'languages', {
        get: () => p.languages,
        configurable: true,
      });
    } catch {
      // fallback: instance 级覆盖
      try {
        Object.defineProperty(navigator, 'languages', {
          get: () => p.languages,
          configurable: true,
        });
      } catch {
        /* ignore */
      }
    }

    // navigator.language 单数 = 数组首项
    try {
      Object.defineProperty(Object.getPrototypeOf(navigator), 'language', {
        get: () => p.locale,
        configurable: true,
      });
    } catch {
      try {
        Object.defineProperty(navigator, 'language', {
          get: () => p.locale,
          configurable: true,
        });
      } catch {
        /* ignore */
      }
    }

    // ─── ② Intl.DateTimeFormat.prototype.resolvedOptions ────────
    // CDP setLocaleOverride/setTimezoneOverride 应该已经处理 · 这里加双保险
    // 重点: timeZone + locale 必须跟 D7-3 探测一致 · 防被 JS 测试出 mismatch
    try {
      const proto = Intl.DateTimeFormat.prototype;
      const original = proto.resolvedOptions;
      proto.resolvedOptions = function patched(this: Intl.DateTimeFormat) {
        const r = original.call(this);
        // 强制覆盖关键字段 · 不动其他 (numberingSystem / calendar 等保留原值)
        r.timeZone = p.timezone;
        r.locale = p.locale;
        return r;
      };
    } catch {
      /* ignore */
    }

    // ─── ③ navigator.permissions.query ──────────────────────────
    // 真 Chromium 默认: notifications/midi/push 都返 'prompt' (未请求过)
    // 自动化可能让 default = 'denied' 或 throw · 用补丁返合理值
    try {
      const perm = navigator.permissions;
      if (perm && typeof perm.query === 'function') {
        const original = perm.query.bind(perm);
        // PermissionDescriptor.name 在 lib.dom.d.ts 是窄联合 (不含 midi)
        // 用 string 做比对 · 接收器对未知 name 也走 fallback original
        perm.query = (descriptor: PermissionDescriptor) => {
          const name = (descriptor && descriptor.name) as string;
          if (name === 'notifications' || name === 'midi' || name === 'push') {
            // 返"未授权未拒绝"标准状态 · 跟真 Chromium 一致
            const fakeStatus = {
              state: 'prompt' as PermissionState,
              name,
              onchange: null,
              addEventListener: () => {},
              removeEventListener: () => {},
              dispatchEvent: () => false,
            };
            return Promise.resolve(fakeStatus as unknown as PermissionStatus);
          }
          // 其他权限 (geolocation / camera / mic 等) 走原 · 不污染
          return original(descriptor);
        };
      }
    } catch {
      /* ignore */
    }

    // ─── ④ chrome.runtime · minimal stub ────────────────────────
    // stealth plugin 删了 window.chrome · 但 navigator.userAgent 含 "Chrome/" 时
    // 真浏览器一定有 window.chrome 对象 · 没有 = bot 信号
    // minimal: 只够"看上去存在" · 不实际提供 extension API
    try {
      const w = window as unknown as { chrome?: Record<string, unknown> };
      if (!w.chrome || typeof w.chrome !== 'object') {
        Object.defineProperty(window, 'chrome', {
          value: {},
          writable: true,
          configurable: true,
        });
      }
      const chromeObj = (window as unknown as { chrome: Record<string, unknown> }).chrome;
      if (!chromeObj.runtime) {
        // 真 Chrome 普通页面 chrome.runtime 是 object · 但里面方法多数 undefined
        // (extension API 只在装了扩展时才注入)
        chromeObj.runtime = {
          // 最小可探测集 · WA Web 有可能 typeof 检查
          OnInstalledReason: {
            CHROME_UPDATE: 'chrome_update',
            INSTALL: 'install',
            SHARED_MODULE_UPDATE: 'shared_module_update',
            UPDATE: 'update',
          },
          OnRestartRequiredReason: {
            APP_UPDATE: 'app_update',
            OS_UPDATE: 'os_update',
            PERIODIC: 'periodic',
          },
          PlatformArch: {
            ARM: 'arm',
            ARM64: 'arm64',
            MIPS: 'mips',
            MIPS64: 'mips64',
            X86_32: 'x86-32',
            X86_64: 'x86-64',
          },
          PlatformOs: {
            ANDROID: 'android',
            CROS: 'cros',
            FUCHSIA: 'fuchsia',
            LINUX: 'linux',
            MAC: 'mac',
            OPENBSD: 'openbsd',
            WIN: 'win',
          },
          RequestUpdateCheckStatus: {
            NO_UPDATE: 'no_update',
            THROTTLED: 'throttled',
            UPDATE_AVAILABLE: 'update_available',
          },
          // id / getURL / sendMessage 等故意不设 · 真 Chrome 普通页面也没
        };
      }
    } catch {
      /* ignore */
    }
  }, params);

  log.info(
    {
      languages: loc.languages,
      locale: loc.locale,
      timezone: loc.timezone,
    },
    'D7-2 stealth overrides injected (navigator.languages + Intl + permissions + chrome.runtime)',
  );
}
