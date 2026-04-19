// proxy.conf 落盘 — 人读、排查、备份用. 运行时以 DB proxy 行为准.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import type { Agent } from 'node:http';
import { getSlotDir } from './storage';

export interface ProxyDescriptor {
  type: 'http' | 'https' | 'socks5' | 'residential_static' | 'residential_rotating' | 'datacenter';
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
}

function proxyConfPath(slotIndex: number): string {
  return path.join(getSlotDir(slotIndex), 'proxy.conf');
}

export function writeProxyConf(slotIndex: number, desc: ProxyDescriptor | null): void {
  const p = proxyConfPath(slotIndex);
  if (!desc) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return;
  }
  // 便于租户/运维直接看, 一行一项
  const lines = [
    `# WAhubX slot ${slotIndex} proxy config (DB 为权威, 此文件仅快照)`,
    `type=${desc.type}`,
    `host=${desc.host}`,
    `port=${desc.port}`,
  ];
  if (desc.username) lines.push(`username=${desc.username}`);
  // 密码不写明文 — 运维看到文件以为是配置源就危险; 写占位
  if (desc.password) lines.push(`password=<stored in DB>`);
  fs.writeFileSync(p, lines.join('\n') + '\n', 'utf-8');
}

/**
 * 构造 Baileys 可用的 agent. 返回 null = 不走代理 (dev 直连).
 * 支持 HTTP(S) 和 SOCKS5 两类; residential_* 归到 HTTPS (多数住宅代理走 HTTP CONNECT).
 */
export function buildProxyAgent(desc: ProxyDescriptor | null): Agent | null {
  if (!desc) return null;
  const auth = desc.username && desc.password ? `${encodeURIComponent(desc.username)}:${encodeURIComponent(desc.password)}@` : '';
  const url = `${getScheme(desc.type)}://${auth}${desc.host}:${desc.port}`;
  if (desc.type === 'socks5') {
    return new SocksProxyAgent(url);
  }
  return new HttpsProxyAgent(url);
}

function getScheme(type: ProxyDescriptor['type']): string {
  if (type === 'socks5') return 'socks5';
  if (type === 'https') return 'https';
  return 'http'; // http / residential_* / datacenter 走 HTTP CONNECT
}
