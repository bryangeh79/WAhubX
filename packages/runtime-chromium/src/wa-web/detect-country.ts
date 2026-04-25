// 2026-04-25 · D7-3 · 探测当前出口 IP 国家
//
// 优先级:
//   1. 显式 env PROXY_COUNTRY (运维已知 · 最快 · 最准)
//   2. 通过代理 (或直连) curl ipinfo.io/country · 实测国家
//   3. fallback DEFAULT_COUNTRY (MY)
//
// 不在 D7-3 范围 (放后续):
//   - 缓存 (现在每次 launch 探一次 · 慢但准 · 后续可加 24h cache)
//   - GeoIP 数据库本地化 (现在依赖 ipinfo.io 公网 · 需联网)

import type { Logger } from 'pino';
import { execAsync } from '../util/exec-async';
import {
  getCountryLocale,
  isKnownCountry,
  type CountryLocale,
} from './country-locale';

export interface DetectCountryOptions {
  proxyUrl: string | null;
  proxyAuth?: { user: string; pass: string };
  envCountry: string | null; // process.env.PROXY_COUNTRY
  log: Logger;
}

export interface DetectCountryResult {
  /** 最终选用的 locale 参数 */
  locale: CountryLocale;
  /** 探测到的原始国家代码 (可能跟 locale.country 一样 · 也可能因 fallback 不同) */
  detectedCountry: string | null;
  /** 来源 */
  source: 'env' | 'ipinfo-proxy' | 'ipinfo-direct' | 'fallback';
  /** 是否 fallback 了 (caller 可用来 log warn) */
  fallback: boolean;
  /** 探测耗时 */
  durationMs: number;
}

/**
 * 探测出口 IP 国家 · 返一组 locale 参数
 */
export async function detectCountry(opts: DetectCountryOptions): Promise<DetectCountryResult> {
  const t0 = Date.now();

  // ─── 1. env 显式 ───────────────────────────────────────
  if (opts.envCountry && opts.envCountry.trim()) {
    const code = opts.envCountry.trim().toUpperCase();
    const locale = getCountryLocale(code);
    const known = isKnownCountry(code);
    if (!known) {
      opts.log.warn(
        { envCountry: code, fallback: locale.country },
        'PROXY_COUNTRY env 不在支持表 · fallback 默认',
      );
    }
    return {
      locale,
      detectedCountry: code,
      source: 'env',
      fallback: !known,
      durationMs: Date.now() - t0,
    };
  }

  // ─── 2. ipinfo.io 探测 ─────────────────────────────────
  // ipinfo.io/country 返 2 字母大写 · 1 行 · 比 /json 轻
  const ipinfoUrl = 'https://ipinfo.io/country';
  let cmd: string;
  if (opts.proxyUrl) {
    const authPart = opts.proxyAuth
      ? `-U "${opts.proxyAuth.user}:${opts.proxyAuth.pass}" `
      : '';
    cmd = `curl -s --max-time 10 ${authPart}-x "${opts.proxyUrl}" "${ipinfoUrl}"`;
  } else {
    cmd = `curl -s --max-time 10 "${ipinfoUrl}"`;
  }

  try {
    const result = await execAsync(cmd, 12_000);
    if (result.exitCode === 0) {
      const code = result.stdout.trim().toUpperCase();
      // ipinfo 返的 2 字母 ISO · 偶尔会返多余字符 · 严格校验
      if (/^[A-Z]{2}$/.test(code)) {
        const locale = getCountryLocale(code);
        const known = isKnownCountry(code);
        if (!known) {
          opts.log.warn(
            { detectedCountry: code, fallback: locale.country },
            'ipinfo 返国家不在支持表 · fallback 默认',
          );
        }
        return {
          locale,
          detectedCountry: code,
          source: opts.proxyUrl ? 'ipinfo-proxy' : 'ipinfo-direct',
          fallback: !known,
          durationMs: Date.now() - t0,
        };
      }
      opts.log.warn(
        { stdout: result.stdout.slice(0, 50) },
        'ipinfo.io 返格式异常 · fallback',
      );
    } else {
      opts.log.warn(
        { exitCode: result.exitCode, stderr: result.stderr.slice(0, 100) },
        'ipinfo.io curl 失败 · fallback',
      );
    }
  } catch (err) {
    opts.log.warn(
      { err: err instanceof Error ? err.message : err },
      'ipinfo.io 探测异常 · fallback',
    );
  }

  // ─── 3. fallback ─────────────────────────────────────
  const locale = getCountryLocale(null); // 返 DEFAULT_COUNTRY (MY)
  return {
    locale,
    detectedCountry: null,
    source: 'fallback',
    fallback: true,
    durationMs: Date.now() - t0,
  };
}
