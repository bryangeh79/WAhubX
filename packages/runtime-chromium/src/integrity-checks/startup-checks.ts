// 2026-04-25 · runtime 启动后必跑安全闸 (C7 整套自动化)
//
// 顺序固定 (符合 § 锁定 D3 第 1 条):
//   1. C7.3 dns-leak (含 iptables 校验 + launch args 校验 + 4 子项)
//   2. C7.2 proxy-egress (shell/browser/host 三段式)
//
// 任一失败:
//   - 写 JSON 证据
//   - 抛 IntegrityCheckFailedError · runtime 退码 2 退出
//   - 不进入 WA Web 加载 (锁定: 整体性 fail-fast)
//
// 例外: env SKIP_INTEGRITY_CHECKS=true (仅 dev/test override · 生产禁用)

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Page } from 'puppeteer-core';
import type { Logger } from 'pino';
import { checkDnsLeak, type DnsLeakCheckResult } from './dns-leak';
import { checkProxyEgress, type ProxyEgressCheckResult } from './proxy-egress';

export class IntegrityCheckFailedError extends Error {
  constructor(public readonly check: string, message: string) {
    super(`integrity check [${check}] failed: ${message}`);
    this.name = 'IntegrityCheckFailedError';
  }
}

export interface StartupCheckReport {
  runStartedAt: string;
  durationMs: number;
  overallPass: boolean;
  failFastTriggered: boolean;
  reportPath: string;
  checks: Array<{
    name: string;
    pass: boolean;
    durationMs: number;
    error?: string;
    details: unknown;
  }>;
}

export interface StartupChecksOptions {
  page: Page;
  launchArgs: string[];
  proxyUrl: string | null;
  proxyAuth?: { user: string; pass: string };
  hostPublicIp: string | null;
  diagnosticsDir: string;
  log: Logger;
  failFast?: boolean; // 默认 true · SKIP_INTEGRITY_CHECKS env 可覆盖
}

/**
 * 跑全套 + 写证据 · failFast 时任一失败抛 IntegrityCheckFailedError
 */
export async function runStartupChecks(opts: StartupChecksOptions): Promise<StartupCheckReport> {
  const failFast = opts.failFast ?? process.env.SKIP_INTEGRITY_CHECKS !== 'true';
  const startedAt = Date.now();
  const checks: StartupCheckReport['checks'] = [];

  // ─── 1. DNS leak (C7.3) ───────────────────────────────────────
  const t1 = Date.now();
  let dnsLeakResult: DnsLeakCheckResult | null = null;
  let dnsErr: string | undefined;
  try {
    dnsLeakResult = await checkDnsLeak(opts.page, opts.launchArgs, opts.log);
  } catch (e) {
    dnsErr = e instanceof Error ? e.message : String(e);
  }
  checks.push({
    name: 'dns-leak (C7.3.1-3.4)',
    pass: dnsLeakResult?.pass ?? false,
    durationMs: Date.now() - t1,
    error: dnsErr ?? (dnsLeakResult?.pass ? undefined : 'one or more sub-checks failed'),
    details: dnsLeakResult ?? { fatalError: dnsErr },
  });

  // ─── 2. Proxy egress (C7.2) ──────────────────────────────────
  const t2 = Date.now();
  let egressResult: ProxyEgressCheckResult | null = null;
  let egressErr: string | undefined;
  try {
    egressResult = await checkProxyEgress(opts.page, opts.proxyUrl, opts.hostPublicIp, opts.log, opts.proxyAuth);
  } catch (e) {
    egressErr = e instanceof Error ? e.message : String(e);
  }
  checks.push({
    name: 'proxy-egress (C7.2 three-way)',
    pass: egressResult?.pass ?? false,
    durationMs: Date.now() - t2,
    error: egressErr ?? (egressResult?.pass ? undefined : egressResult?.reasons.join(' · ')),
    details: egressResult ?? { fatalError: egressErr },
  });

  // ─── 报告 ─────────────────────────────────────────────────────
  const overallPass = checks.every((c) => c.pass);
  const ts = new Date(startedAt).toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(opts.diagnosticsDir, `startup-checks-${ts}.json`);

  await fs.mkdir(opts.diagnosticsDir, { recursive: true }).catch(() => {});
  const report: StartupCheckReport = {
    runStartedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    overallPass,
    failFastTriggered: !overallPass && failFast,
    reportPath,
    checks,
  };

  try {
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf-8');
    opts.log.info({ reportPath, overallPass }, 'startup-checks report written');
  } catch (err) {
    opts.log.error({ err: err instanceof Error ? err.message : err }, 'failed to write startup-checks report');
  }

  // ─── fail-fast ────────────────────────────────────────────────
  if (!overallPass && failFast) {
    const firstFail = checks.find((c) => !c.pass)!;
    const msg = `${firstFail.name} failed: ${firstFail.error ?? 'see report'} · report=${reportPath}`;
    opts.log.error({ check: firstFail.name, error: firstFail.error, reportPath }, 'INTEGRITY CHECK FAILED · aborting');
    throw new IntegrityCheckFailedError(firstFail.name, msg);
  }

  if (!overallPass && !failFast) {
    opts.log.warn(
      { failedChecks: checks.filter((c) => !c.pass).map((c) => c.name) },
      'integrity checks failed but SKIP_INTEGRITY_CHECKS=true · continuing (DEV ONLY · UNSAFE)',
    );
  }

  return report;
}
