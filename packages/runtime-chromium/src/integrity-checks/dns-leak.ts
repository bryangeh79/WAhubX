// 2026-04-25 · C7.3 · DNS leak 工程封死验证 · 4 子项 (全过)
//
//   C7.3.1 · iptables 53 DROP rules 真在生效 (init.sh 装载 · 这里 dump 比对)
//   C7.3.2 · Chromium launch args 含必要 4 标记 (proxy 模式) / 2 标记 (直连模式)
//   C7.3.3 · negative test: dig/nslookup/getent 全 timeout (53 真封死)
//   C7.3.4 · positive test: page.evaluate fetch ipify 必须成功 (Chromium 走 socks5h 解析 ok)
//
// 注意: positive test 仅在 PROXY_URL 设置时有意义. 直连模式 iptables 封 53 → fetch 必失败 ·
// 此时 positive 不参与 pass 判定 (按 dev/test 模式).

import type { Page } from 'puppeteer-core';
import type { Logger } from 'pino';
import { execAsync } from '../util/exec-async';

export interface DnsLeakSubResult {
  iptables: {
    v4_dpt53_dropped: boolean;
    v6_dpt53_dropped: boolean;
    v4_rules_dump: string;
    v6_rules_dump: string;
  };
  launchArgs: {
    hasProxyServer: boolean;
    hasHostResolverRules: boolean;
    hasDnsOverHttpsDisabled: boolean;
    hasAsyncDnsDisabled: boolean;
    proxyMode: boolean; // 是否配了 PROXY_URL
  };
  negativeTests: {
    dig: { exitCode: number; timedOut: boolean; durationMs: number };
    nslookup: { exitCode: number; timedOut: boolean; durationMs: number };
    getent: { exitCode: number; timedOut: boolean; durationMs: number };
    allFailed: boolean; // 期望全失败
  };
  positiveTest: {
    skipped: boolean;
    skipReason?: string;
    ok: boolean;
    status?: number;
    error?: string;
    durationMs?: number;
  };
}

export interface DnsLeakCheckResult {
  iptablesRulesActive: boolean;
  chromiumArgsCorrect: boolean;
  negativeTestPassed: boolean;
  positiveTestPassed: boolean;
  pass: boolean;
  details: DnsLeakSubResult;
}

const REQUIRED_ARG_PATTERNS = {
  proxyServer: /^--proxy-server=/,
  hostResolverRules: /^--host-resolver-rules=/,
  dnsOverHttpsDisabled: /--disable-features=.*\bDnsOverHttps\b/,
  asyncDnsDisabled: /--disable-features=.*\bAsyncDns\b/,
};

const NEG_TEST_TIMEOUT_MS = 5_000;
const POS_TEST_TIMEOUT_MS = 12_000;

/**
 * 跑全套 C7.3 · 4 子项独立验证 · 任一 false → pass=false
 */
export async function checkDnsLeak(
  page: Page,
  launchArgs: string[],
  log: Logger,
): Promise<DnsLeakCheckResult> {
  // ─── C7.3.1 · iptables 53 DROP 验证 ───────────────────────────
  const v4Dump = await execAsync('iptables -L OUTPUT -n -v 2>/dev/null', 3000);
  const v6Dump = await execAsync('ip6tables -L OUTPUT -n -v 2>/dev/null', 3000);
  // 期望: 4 条 DROP 规则 · v4 udp+tcp · v6 udp+tcp 各 dpt:53
  // 用宽松正则: DROP ... dpt:53 (顺序无关)
  const v4_dpt53_dropped =
    /DROP\s+\S*\s*--.*dpt:53/i.test(v4Dump.stdout) &&
    (v4Dump.stdout.match(/DROP\b.*dpt:53/g)?.length ?? 0) >= 2; // tcp + udp
  const v6_dpt53_dropped =
    /DROP\s+\S*\s*--.*dpt:53/i.test(v6Dump.stdout) &&
    (v6Dump.stdout.match(/DROP\b.*dpt:53/g)?.length ?? 0) >= 2;

  // ─── C7.3.2 · launch args 完整性 ──────────────────────────────
  const hasProxyServer = launchArgs.some((a) => REQUIRED_ARG_PATTERNS.proxyServer.test(a));
  const hasHostResolverRules = launchArgs.some((a) => REQUIRED_ARG_PATTERNS.hostResolverRules.test(a));
  const hasDoH = launchArgs.some((a) => REQUIRED_ARG_PATTERNS.dnsOverHttpsDisabled.test(a));
  const hasAsyncDns = launchArgs.some((a) => REQUIRED_ARG_PATTERNS.asyncDnsDisabled.test(a));
  const proxyMode = hasProxyServer;
  // proxy 模式: 4 项全要 · 直连模式: 至少 DoH + AsyncDns 关 (避免 Chromium 自带 DoH 绕过 iptables)
  const argsCorrect = proxyMode
    ? hasProxyServer && hasHostResolverRules && hasDoH && hasAsyncDns
    : hasDoH && hasAsyncDns;

  // ─── C7.3.3 · negative tests · 全期望 fail ────────────────────
  // 全部加 timeout 包 + 内部超时 · 防真有 DNS 通了挂死整个 check
  const dig = await execAsync(
    'timeout 3 dig @8.8.8.8 example.com +time=1 +tries=1 +short',
    NEG_TEST_TIMEOUT_MS,
  );
  const nslookup = await execAsync(
    'timeout 3 nslookup -timeout=1 example.com 1.1.1.1',
    NEG_TEST_TIMEOUT_MS,
  );
  const getent = await execAsync('timeout 3 getent hosts example.com', NEG_TEST_TIMEOUT_MS);
  // 全部 exit !=0 才算通过 (53 封死了)
  const negAllFailed = dig.exitCode !== 0 && nslookup.exitCode !== 0 && getent.exitCode !== 0;

  // ─── C7.3.4 · positive test · 仅 proxy 模式 ──────────────────
  let positiveSkipped = false;
  let positiveOk = true; // 跳过时不参与判定 · 设 true 避免误降
  let positiveStatus: number | undefined;
  let positiveError: string | undefined;
  let positiveDurationMs: number | undefined;
  let positiveSkipReason: string | undefined;

  if (!proxyMode) {
    positiveSkipped = true;
    positiveSkipReason = 'no PROXY_URL · 直连模式 iptables 封 53 自然失败 · positive test 不参与判定';
  } else {
    const t0 = Date.now();
    try {
      const r = await page.evaluate(async (timeoutMs: number) => {
        try {
          const resp = await fetch('https://api.ipify.org?format=json', {
            cache: 'no-store',
            signal: AbortSignal.timeout(timeoutMs),
          });
          return { ok: resp.ok, status: resp.status, error: undefined as string | undefined };
        } catch (e) {
          return {
            ok: false,
            status: undefined as number | undefined,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }, POS_TEST_TIMEOUT_MS);
      positiveOk = r.ok;
      positiveStatus = r.status;
      positiveError = r.error;
    } catch (err) {
      positiveOk = false;
      positiveError = err instanceof Error ? err.message : String(err);
    }
    positiveDurationMs = Date.now() - t0;
  }

  const details: DnsLeakSubResult = {
    iptables: {
      v4_dpt53_dropped,
      v6_dpt53_dropped,
      v4_rules_dump: v4Dump.stdout.split('\n').slice(0, 8).join('\n'),
      v6_rules_dump: v6Dump.stdout.split('\n').slice(0, 8).join('\n'),
    },
    launchArgs: {
      hasProxyServer,
      hasHostResolverRules,
      hasDnsOverHttpsDisabled: hasDoH,
      hasAsyncDnsDisabled: hasAsyncDns,
      proxyMode,
    },
    negativeTests: {
      dig: { exitCode: dig.exitCode, timedOut: dig.timedOut, durationMs: dig.durationMs },
      nslookup: { exitCode: nslookup.exitCode, timedOut: nslookup.timedOut, durationMs: nslookup.durationMs },
      getent: { exitCode: getent.exitCode, timedOut: getent.timedOut, durationMs: getent.durationMs },
      allFailed: negAllFailed,
    },
    positiveTest: {
      skipped: positiveSkipped,
      skipReason: positiveSkipReason,
      ok: positiveOk,
      status: positiveStatus,
      error: positiveError,
      durationMs: positiveDurationMs,
    },
  };

  const iptablesOk = v4_dpt53_dropped && v6_dpt53_dropped;
  const passAll = iptablesOk && argsCorrect && negAllFailed && positiveOk;

  log.info(
    {
      iptablesOk,
      argsCorrect,
      negAllFailed,
      positiveOk,
      positiveSkipped,
    },
    'C7.3 DNS leak check breakdown',
  );

  return {
    iptablesRulesActive: iptablesOk,
    chromiumArgsCorrect: argsCorrect,
    negativeTestPassed: negAllFailed,
    positiveTestPassed: positiveOk,
    pass: passAll,
    details,
  };
}
