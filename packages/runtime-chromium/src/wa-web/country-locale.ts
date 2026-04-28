// 2026-04-25 · D7-3 · 国家 → locale 一组参数 (Codex 拍板顺序首项)
//
// 目的: 让 Chromium 在 WA 眼里看到的"国籍画像"全栈一致.
// timezone / locale / languages / acceptLanguage 必须跟代理 IP 国家匹配 · 否则
// WA 反作弊看到 "UK SIM 在马来 IP 操作 + en-US locale + Asia/KL timezone" = 三处冲突.
//
// 不在 D7-3 范围 (放 D7-2 做):
//   - navigator.languages 注入伪造
//   - Intl.DateTimeFormat resolvedOptions 伪造
//   - WebGL renderer 国家化
//
// 设计:
//   - 表里覆盖产品当前 + 近期可能进入的市场
//   - 默认 fallback = MY (产品定位)
//   - 任何未知国家 → fallback · 但 log warn (方便后续补)

export interface CountryLocale {
  /** ISO 2 字母 · 大写 */
  country: string;
  /** IANA 时区 · e.g. 'Asia/Kuala_Lumpur' */
  timezone: string;
  /** BCP 47 主 locale · 给 navigator.language / Intl */
  locale: string;
  /** BCP 47 数组 · 给 navigator.languages · 顺序 = 用户偏好顺序 */
  languages: string[];
  /** HTTP Accept-Language header · 含 q 权重 */
  acceptLanguage: string;
}

// ═══ 国家表 (覆盖 WA 全球 top 市场 + 产品近期市场) ═══════════════════════
const TABLE: Record<string, CountryLocale> = {
  // ─── 东南亚 (产品主战场) ────────────────────────────
  MY: {
    country: 'MY',
    timezone: 'Asia/Kuala_Lumpur',
    locale: 'en-MY',
    languages: ['en-MY', 'en', 'ms', 'zh-CN'],
    acceptLanguage: 'en-MY,en;q=0.9,ms;q=0.8,zh-CN;q=0.7',
  },
  SG: {
    country: 'SG',
    timezone: 'Asia/Singapore',
    locale: 'en-SG',
    languages: ['en-SG', 'en', 'zh-CN', 'ms'],
    acceptLanguage: 'en-SG,en;q=0.9,zh-CN;q=0.8,ms;q=0.7',
  },
  ID: {
    country: 'ID',
    timezone: 'Asia/Jakarta',
    locale: 'id-ID',
    languages: ['id-ID', 'id', 'en'],
    acceptLanguage: 'id-ID,id;q=0.9,en;q=0.8',
  },
  TH: {
    country: 'TH',
    timezone: 'Asia/Bangkok',
    locale: 'th-TH',
    languages: ['th-TH', 'th', 'en'],
    acceptLanguage: 'th-TH,th;q=0.9,en;q=0.8',
  },
  VN: {
    country: 'VN',
    timezone: 'Asia/Ho_Chi_Minh',
    locale: 'vi-VN',
    languages: ['vi-VN', 'vi', 'en'],
    acceptLanguage: 'vi-VN,vi;q=0.9,en;q=0.8',
  },
  PH: {
    country: 'PH',
    timezone: 'Asia/Manila',
    locale: 'en-PH',
    languages: ['en-PH', 'en', 'tl'],
    acceptLanguage: 'en-PH,en;q=0.9,tl;q=0.8',
  },

  // ─── 东亚 ─────────────────────────────────────────
  HK: {
    country: 'HK',
    timezone: 'Asia/Hong_Kong',
    locale: 'zh-HK',
    languages: ['zh-HK', 'zh', 'en'],
    acceptLanguage: 'zh-HK,zh;q=0.9,en;q=0.8',
  },
  TW: {
    country: 'TW',
    timezone: 'Asia/Taipei',
    locale: 'zh-TW',
    languages: ['zh-TW', 'zh', 'en'],
    acceptLanguage: 'zh-TW,zh;q=0.9,en;q=0.8',
  },

  // ─── 南亚 ─────────────────────────────────────────
  IN: {
    country: 'IN',
    timezone: 'Asia/Kolkata',
    locale: 'en-IN',
    languages: ['en-IN', 'en', 'hi'],
    acceptLanguage: 'en-IN,en;q=0.9,hi;q=0.8',
  },

  // ─── 北美 ─────────────────────────────────────────
  US: {
    country: 'US',
    timezone: 'America/New_York', // 默认东岸 · 大量真用户也是这
    locale: 'en-US',
    languages: ['en-US', 'en'],
    acceptLanguage: 'en-US,en;q=0.9',
  },
  CA: {
    country: 'CA',
    timezone: 'America/Toronto',
    locale: 'en-CA',
    languages: ['en-CA', 'en', 'fr-CA'],
    acceptLanguage: 'en-CA,en;q=0.9,fr-CA;q=0.8',
  },
  MX: {
    country: 'MX',
    timezone: 'America/Mexico_City',
    locale: 'es-MX',
    languages: ['es-MX', 'es', 'en'],
    acceptLanguage: 'es-MX,es;q=0.9,en;q=0.8',
  },

  // ─── 拉美 (WA 重镇 · BR 是 WA 全球第二大市场) ────────
  BR: {
    country: 'BR',
    timezone: 'America/Sao_Paulo',
    locale: 'pt-BR',
    languages: ['pt-BR', 'pt', 'en'],
    acceptLanguage: 'pt-BR,pt;q=0.9,en;q=0.8',
  },
  AR: {
    country: 'AR',
    timezone: 'America/Argentina/Buenos_Aires',
    locale: 'es-AR',
    languages: ['es-AR', 'es', 'en'],
    acceptLanguage: 'es-AR,es;q=0.9,en;q=0.8',
  },

  // ─── 欧洲 ─────────────────────────────────────────
  GB: {
    country: 'GB',
    timezone: 'Europe/London',
    locale: 'en-GB',
    languages: ['en-GB', 'en'],
    acceptLanguage: 'en-GB,en;q=0.9',
  },
  DE: {
    country: 'DE',
    timezone: 'Europe/Berlin',
    locale: 'de-DE',
    languages: ['de-DE', 'de', 'en'],
    acceptLanguage: 'de-DE,de;q=0.9,en;q=0.8',
  },
  FR: {
    country: 'FR',
    timezone: 'Europe/Paris',
    locale: 'fr-FR',
    languages: ['fr-FR', 'fr', 'en'],
    acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.8',
  },
  ES: {
    country: 'ES',
    timezone: 'Europe/Madrid',
    locale: 'es-ES',
    languages: ['es-ES', 'es', 'en'],
    acceptLanguage: 'es-ES,es;q=0.9,en;q=0.8',
  },
  IT: {
    country: 'IT',
    timezone: 'Europe/Rome',
    locale: 'it-IT',
    languages: ['it-IT', 'it', 'en'],
    acceptLanguage: 'it-IT,it;q=0.9,en;q=0.8',
  },

  // ─── 中东 / 非洲 ────────────────────────────────────
  AE: {
    country: 'AE',
    timezone: 'Asia/Dubai',
    locale: 'en-AE',
    languages: ['en-AE', 'en', 'ar'],
    acceptLanguage: 'en-AE,en;q=0.9,ar;q=0.8',
  },
  SA: {
    country: 'SA',
    timezone: 'Asia/Riyadh',
    locale: 'ar-SA',
    languages: ['ar-SA', 'ar', 'en'],
    acceptLanguage: 'ar-SA,ar;q=0.9,en;q=0.8',
  },
  NG: {
    country: 'NG',
    timezone: 'Africa/Lagos',
    locale: 'en-NG',
    languages: ['en-NG', 'en'],
    acceptLanguage: 'en-NG,en;q=0.9',
  },
  ZA: {
    country: 'ZA',
    timezone: 'Africa/Johannesburg',
    locale: 'en-ZA',
    languages: ['en-ZA', 'en'],
    acceptLanguage: 'en-ZA,en;q=0.9',
  },
};

// 产品默认 = 马来西亚
export const DEFAULT_COUNTRY: CountryLocale = TABLE.MY;

/**
 * 国家 ISO 2 字母 → 一组 locale 参数
 * 未知国家返默认 (MY) · caller 应该 log warn
 */
export function getCountryLocale(countryCode: string | null | undefined): CountryLocale {
  if (!countryCode) return DEFAULT_COUNTRY;
  const upper = countryCode.toUpperCase().trim();
  return TABLE[upper] ?? DEFAULT_COUNTRY;
}

/**
 * 是否在表里 (caller 可用来判定是否 fallback 了 · 加 warn log)
 */
export function isKnownCountry(countryCode: string | null | undefined): boolean {
  if (!countryCode) return false;
  return TABLE[countryCode.toUpperCase().trim()] !== undefined;
}

export const SUPPORTED_COUNTRIES = Object.keys(TABLE);
