// 2026-04-22 · SIM 录入相关类型 · 和 backend/src/data/telco-registry.ts 保持同步
export interface Telco {
  id: string;
  name: string;
  brand?: string;
  color?: string;
}

export interface PrefixHint {
  prefix: string;
  defaultTelcoId: string;
}

export interface Country {
  code: string;
  callingCode: string;
  flag: string;
  name: string;
  telcos: Telco[];
  prefixHints?: PrefixHint[];
}

export interface SimInfoPayload {
  countryCode?: string | null;
  carrierId?: string | null;
  customCarrierName?: string | null;
  customCountryName?: string | null;
  iccidSuffix?: string | null;
  notes?: string | null;
}

/** 号码去掉 '+' 和非数字 · 返回 {country, nationalNumber, defaultTelcoId} */
export function inferFromPhone(
  rawPhone: string | null | undefined,
  registry: Country[],
): { country: Country | null; defaultTelcoId: string | null; nationalNumber: string } {
  const digits = (rawPhone ?? '').replace(/\D+/g, '');
  if (!digits) return { country: null, defaultTelcoId: null, nationalNumber: '' };

  const sorted = [...registry].sort((a, b) => b.callingCode.length - a.callingCode.length);
  for (const c of sorted) {
    if (digits.startsWith(c.callingCode)) {
      const nationalNumber = digits.slice(c.callingCode.length).replace(/^0+/, '');
      let defaultTelcoId: string | null = null;
      if (c.prefixHints) {
        const hintSorted = [...c.prefixHints].sort(
          (a, b) => b.prefix.length - a.prefix.length,
        );
        for (const h of hintSorted) {
          if (nationalNumber.startsWith(h.prefix)) {
            defaultTelcoId = h.defaultTelcoId;
            break;
          }
        }
      }
      return { country: c, defaultTelcoId, nationalNumber };
    }
  }
  return { country: null, defaultTelcoId: null, nationalNumber: digits };
}
