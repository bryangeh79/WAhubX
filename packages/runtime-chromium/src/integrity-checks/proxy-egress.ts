// 2026-04-25 · C7.2 · 代理出口 IP 三段式验证
//
// 通过条件:
//   (a) browserIp === shellIp                (容器内两条出口路径一致)
//   (b) browserIp !== hostPublicIp           (没漏到宿主)
//   (c) [可选] browserIp === provider 报告 outbound IP (代理商支持时)
//
// D3 实装 · D2 占位

import type { Page } from 'puppeteer-core';

export interface ProxyEgressCheckResult {
  shellIp: string | null;
  browserIp: string | null;
  hostPublicIp: string | null; // 仅开发环境从外部传入
  pass: boolean;
  reason?: string;
}

/**
 * D3 实装. 当前 stub.
 * 容器内 shell curl + page.evaluate fetch · 比对一致性.
 */
export async function checkProxyEgress(_page: Page, _hostPublicIp?: string): Promise<ProxyEgressCheckResult> {
  // TODO(D3):
  // 1. shellIp = exec curl https://api.ipify.org (容器内 child_process)
  // 2. browserIp = page.evaluate fetch ipify
  // 3. 比对 (a) (b) (c)
  return {
    shellIp: null,
    browserIp: null,
    hostPublicIp: _hostPublicIp ?? null,
    pass: true,
    reason: 'D3 stub · not yet implemented',
  };
}
