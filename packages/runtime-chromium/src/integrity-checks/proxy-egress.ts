// 2026-04-25 · C7.2 · 代理出口 IP 三段式验证
//
// 通过条件 (锁定 § Fix 5):
//   (a) browserIp === shellIp                · 容器内两条出口路径必须一致
//   (b) browserIp !== hostPublicIp           · 没漏到宿主网卡
//   (c) [可选] browserIp === provider 报告 outbound IP (代理商支持时 · POC 不强制)
//
// 输出: 结构化 JSON · 不只 log.

import type { Page } from 'puppeteer-core';
import type { Logger } from 'pino';
import { execAsync } from '../util/exec-async';

export interface ProxyEgressCheckResult {
  shellIp: string | null;
  browserIp: string | null;
  hostPublicIp: string | null;
  proxyMode: boolean;        // PROXY_URL 是否设
  shellEqualsBrowser: boolean;
  browserNotEqualsHost: boolean | 'unknown'; // hostPublicIp 未提供时 unknown
  pass: boolean;
  reasons: string[];
  durations: { shellMs: number; browserMs: number };
  rawShellResult: { exitCode: number; stdout: string; stderr: string };
  rawBrowserError?: string;
}

/**
 * 三段式. shellIp 走容器内 curl (强制经 PROXY_URL · 否则跟 chromium 不同源 · 失去比对意义).
 * browserIp 走 page.evaluate fetch.
 */
export async function checkProxyEgress(
  page: Page,
  proxyUrl: string | null,
  hostPublicIp: string | null,
  log: Logger,
  proxyAuth?: { user: string; pass: string },
): Promise<ProxyEgressCheckResult> {
  const reasons: string[] = [];

  // ─── shellIp ─────────────────────────────────────────────────
  // 必须经 proxy · 否则跟 chromium 走的不是同一条出口 · 比对无意义
  // 直连模式: shell curl 也直连 (host 解析必失败 · 因为 53 封死) · 设计上等同 chromium 也连不出去
  // proxyAuth 传 user/pass · 拼进 -U 参数 (curl proxy auth)
  let shellCmd: string;
  if (proxyUrl) {
    const authPart = proxyAuth ? `-U "${proxyAuth.user}:${proxyAuth.pass}" ` : '';
    shellCmd = `curl -s --max-time 12 ${authPart}-x "${proxyUrl}" https://api.ipify.org`;
  } else {
    shellCmd = `curl -s --max-time 12 https://api.ipify.org`;
  }
  const shellResult = await execAsync(shellCmd, 15_000);
  const shellIp = shellResult.exitCode === 0 ? shellResult.stdout.trim().slice(0, 64) : null;

  // ─── browserIp ───────────────────────────────────────────────
  let browserIp: string | null = null;
  let browserError: string | undefined;
  const t0 = Date.now();
  try {
    const r = await page.evaluate(async (timeoutMs: number) => {
      try {
        const resp = await fetch('https://api.ipify.org?format=json', {
          cache: 'no-store',
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!resp.ok) return { ip: null, error: `HTTP ${resp.status}` };
        const j = (await resp.json()) as { ip?: string };
        return { ip: j.ip ?? null, error: undefined as string | undefined };
      } catch (e) {
        return { ip: null, error: e instanceof Error ? e.message : String(e) };
      }
    }, 15_000);
    browserIp = r.ip;
    browserError = r.error;
  } catch (err) {
    browserError = err instanceof Error ? err.message : String(err);
  }
  const browserDurationMs = Date.now() - t0;

  // ─── 判定 ────────────────────────────────────────────────────
  const shellEqualsBrowser = !!shellIp && !!browserIp && shellIp === browserIp;
  let browserNotEqualsHost: boolean | 'unknown' = 'unknown';
  if (hostPublicIp) {
    browserNotEqualsHost = !!browserIp && browserIp !== hostPublicIp;
  }

  let pass = true;
  if (!shellIp) {
    pass = false;
    reasons.push(`shellIp not obtained (curl exit=${shellResult.exitCode}, stderr=${shellResult.stderr.slice(0, 100)})`);
  }
  if (!browserIp) {
    pass = false;
    reasons.push(`browserIp not obtained (${browserError ?? 'unknown error'})`);
  }
  if (shellIp && browserIp && shellIp !== browserIp) {
    pass = false;
    reasons.push(`MISMATCH: shellIp=${shellIp} !== browserIp=${browserIp} · 两条出口路径不一致`);
  }
  if (hostPublicIp && browserIp === hostPublicIp) {
    pass = false;
    reasons.push(`LEAK: browserIp(${browserIp}) === hostPublicIp(${hostPublicIp}) · 漏到宿主`);
  }
  if (!hostPublicIp) {
    reasons.push('hostPublicIp not provided · (b) 三段式中 host 比对项 unknown · 不影响 pass 但建议生产配 HOST_PUBLIC_IP env');
  }

  log.info(
    {
      shellIp,
      browserIp,
      hostPublicIp,
      shellEqualsBrowser,
      browserNotEqualsHost,
      pass,
    },
    'C7.2 proxy-egress check breakdown',
  );

  return {
    shellIp,
    browserIp,
    hostPublicIp,
    proxyMode: !!proxyUrl,
    shellEqualsBrowser,
    browserNotEqualsHost,
    pass,
    reasons,
    durations: { shellMs: shellResult.durationMs, browserMs: browserDurationMs },
    rawShellResult: {
      exitCode: shellResult.exitCode,
      stdout: shellResult.stdout.slice(0, 200),
      stderr: shellResult.stderr.slice(0, 200),
    },
    rawBrowserError: browserError,
  };
}
