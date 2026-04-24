import { useEffect, useState } from 'react';
import { campaignStateApi } from './campaigns-api';

// 2026-04-23 · 缓存广告模块 feature flag · 登录后读一次 · sessionStorage 缓存 5 分钟
// 默认 off → tab 不显 · 用户在 dev 用 SQL 打开后, 下次登录才生效 (可强刷浏览器)

const CACHE_KEY = 'wahubx_campaign_flag';
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  enabled: boolean;
  at: number;
}

export function useCampaignFlag(): boolean {
  const [enabled, setEnabled] = useState<boolean>(() => {
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw) as CacheEntry;
        if (Date.now() - cached.at < CACHE_TTL_MS) return cached.enabled;
      }
    } catch {
      /* ignore */
    }
    return false;
  });

  useEffect(() => {
    let cancelled = false;
    campaignStateApi.moduleEnabled().then((val) => {
      if (cancelled) return;
      setEnabled(val);
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ enabled: val, at: Date.now() } as CacheEntry));
      } catch {
        /* ignore */
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return enabled;
}
