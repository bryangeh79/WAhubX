// 2026-04-25 · runtime 启动后必须先过的安全闸 (C7 / C8 自动化验证)
//
// D3 实装 · D2 仅占位 · index.ts 调用入口收口在这
// 验证项 (按 § 第 4 轮 锁定 POC 验收标准):
//   C7.2 · proxy 出口 IP 三段式 (browserIp === shellIp · browserIp !== hostPublicIp)
//   C7.3.1 · iptables 53 DROP (init.sh 已装载 · 这里 verify dump)
//   C7.3.2 · Chromium launch args 含 socks5h + host-resolver-rules + DnsOverHttps disable
//   C7.3.3 · negative test (dig timeout · nslookup timeout · getent fail)
//   C7.3.4 · positive test (browser fetch ipify ok)
//
// 不通过即抛 IntegrityCheckFailedError · runtime 立即退出.
// runtime 开发周内 (D2) 这模块只导出占位 · D3 真实装

import type { Page } from 'puppeteer-core';

export class IntegrityCheckFailedError extends Error {
  constructor(public readonly check: string, message: string) {
    super(`integrity check [${check}] failed: ${message}`);
    this.name = 'IntegrityCheckFailedError';
  }
}

export interface IntegrityCheckResult {
  check: string;
  ok: boolean;
  details?: Record<string, unknown>;
  error?: string;
}

export interface StartupChecksOptions {
  page: Page;
  proxyUrl: string | null; // socks5h://... · null 表示直连 (开发环境)
  expectedShellIpFn?: () => Promise<string>; // 容器内 curl 出口 IP
  expectedHostPublicIpFn?: () => Promise<string>; // host curl 出口 IP (开发期)
}

/**
 * D2 占位 · D3 实装. 当前直接返 OK · 不阻断 D2 跑通 WA Web 加载.
 * D3 接入后会自动跑 C7.2 + C7.3 全套.
 */
export async function runStartupChecks(opts: StartupChecksOptions): Promise<IntegrityCheckResult[]> {
  // TODO(D3): proxyEgress + dnsLeak 实装
  return [
    { check: 'startup-checks-stub', ok: true, details: { note: 'D3 will implement' } },
  ];
}
