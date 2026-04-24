// 2026-04-22 · 从 E.164 电话号推断国家 + 号码前缀提示
// 用于 SIM 信息录入时自动识别国家 · 避免租户手选
import { COUNTRY_REGISTRY, type Country, type PrefixHint } from '../data/telco-registry';

// 按 callingCode 长度倒序 · 长前缀先匹配 (如 855 要比 85 先试)
const CODES_SORTED = [...COUNTRY_REGISTRY].sort(
  (a, b) => b.callingCode.length - a.callingCode.length,
);

/**
 * 从原始手机号 (可能带 +/空格/-/0 开头) 推断国家.
 * 返回匹配的 Country 或 null.
 *
 * 示例:
 *   inferCountry('60168160836')   → Malaysia
 *   inferCountry('+60 16-816 0836') → Malaysia
 *   inferCountry('8613812345678') → China
 *   inferCountry('442071234567') → UK
 */
export function inferCountry(rawPhone: string | null | undefined): Country | null {
  if (!rawPhone) return null;
  const digits = rawPhone.replace(/\D+/g, '');
  if (!digits) return null;

  for (const c of CODES_SORTED) {
    if (digits.startsWith(c.callingCode)) {
      return c;
    }
  }
  return null;
}

/**
 * 拿到国家后 · 根据 "去掉国家代码后剩下的号码" 的前缀 · 返回推荐 telco id.
 * 如果 country 没配 prefixHints 或无匹配 · 返 null.
 *
 * 示例:
 *   inferDefaultTelco(Malaysia, '168160836') → 'digi' (16 前缀)
 */
export function inferDefaultTelco(
  country: Country,
  phoneWithoutCallingCode: string,
): string | null {
  if (!country.prefixHints || country.prefixHints.length === 0) return null;
  const digits = phoneWithoutCallingCode.replace(/\D+/g, '').replace(/^0+/, '');
  // 最长前缀优先
  const sorted = [...country.prefixHints].sort(
    (a: PrefixHint, b: PrefixHint) => b.prefix.length - a.prefix.length,
  );
  for (const h of sorted) {
    if (digits.startsWith(h.prefix)) return h.defaultTelcoId;
  }
  return null;
}

/**
 * 一站式: 从原始号推 country + default telco.
 */
export function inferFromPhone(rawPhone: string | null | undefined): {
  country: Country | null;
  defaultTelcoId: string | null;
  nationalNumber: string | null;
} {
  if (!rawPhone) return { country: null, defaultTelcoId: null, nationalNumber: null };
  const digits = rawPhone.replace(/\D+/g, '');
  const country = inferCountry(digits);
  if (!country) return { country: null, defaultTelcoId: null, nationalNumber: null };

  const nationalNumber = digits.slice(country.callingCode.length);
  const defaultTelcoId = inferDefaultTelco(country, nationalNumber);
  return { country, defaultTelcoId, nationalNumber };
}
