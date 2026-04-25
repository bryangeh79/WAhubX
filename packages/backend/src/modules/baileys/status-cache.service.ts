// 2026-04-22 · Status Feed 缓存服务
// Baileys 6.7.x 没有统一 getStatusFeed API · 需要通过 messages.upsert 监听 status@broadcast 自攒
// 给 status_browse / status_browse_bulk / status_react 3 个 executor 共用
//
// 用途:
//   - 记录每个 account 收到过的他人 status
//   - 给 executor 提供 "最近 N 条 status 的 key 列表" 用于 readMessages / react
//   - 去重: 同一个 key 只保存一次
import { Injectable, Logger } from '@nestjs/common';
import type { WAMessageKey } from '@whiskeysockets/baileys';

export interface CachedStatus {
  key: WAMessageKey;             // 原始 key · readMessages/react 用
  author: string;                // 发 status 的 jid (participant)
  timestamp: number;             // unix ms
  viewed: boolean;               // 本账号是否已标记已读
  reacted: boolean;              // 本账号是否已给过 react
}

@Injectable()
export class StatusCacheService {
  private readonly logger = new Logger(StatusCacheService.name);
  // accountId → (status key str → CachedStatus)
  private cache = new Map<number, Map<string, CachedStatus>>();
  private readonly MAX_PER_ACCOUNT = 200;
  private readonly TTL_MS = 24 * 60 * 60 * 1000; // 24h · WA status 存活期

  /** BaileysService 在 spawn sock 时调 · 挂 messages.upsert 监听 (老路径 · pool sock) */
  registerStatusListener(accountId: number, ev: { on: (evt: string, fn: (msg: unknown) => void) => void }): void {
    ev.on('messages.upsert', (payload: unknown) => {
      try {
        const { messages } = payload as { messages: Array<{ key: WAMessageKey; messageTimestamp?: number | Long }> };
        if (!Array.isArray(messages)) return;
        for (const m of messages) {
          if (!m.key || m.key.remoteJid !== 'status@broadcast') continue;
          this.add(accountId, m);
        }
      } catch (err) {
        this.logger.warn(`status cache listener error · acc=${accountId}: ${err}`);
      }
    });
  }

  /**
   * 2026-04-25 · Phase 2 · worker 模式入口 · BaileysService.onWorkerMessageUpsert 调用
   * 把 worker 转发的消息中属于 status@broadcast 的塞入缓存
   */
  feedFromWorker(accountId: number, messages: unknown[]): void {
    try {
      const arr = messages as Array<{ key?: WAMessageKey; messageTimestamp?: number | Long }>;
      for (const m of arr) {
        if (!m.key || m.key.remoteJid !== 'status@broadcast') continue;
        this.add(accountId, m as { key: WAMessageKey; messageTimestamp?: number | Long });
      }
    } catch (err) {
      this.logger.warn(`feedFromWorker error · acc=${accountId}: ${err}`);
    }
  }

  /** 在缓存里加一条 status · 去重 · 按大小限流 */
  private add(accountId: number, msg: { key: WAMessageKey; messageTimestamp?: number | Long }): void {
    const keyStr = `${msg.key.remoteJid}|${msg.key.id}`;
    let m = this.cache.get(accountId);
    if (!m) {
      m = new Map();
      this.cache.set(accountId, m);
    }
    if (m.has(keyStr)) return;
    const ts =
      typeof msg.messageTimestamp === 'number'
        ? msg.messageTimestamp * 1000
        : Date.now();
    m.set(keyStr, {
      key: msg.key,
      author: msg.key.participant ?? msg.key.remoteJid ?? '',
      timestamp: ts,
      viewed: false,
      reacted: false,
    });
    // 限流: 每 account 最多 MAX · 先 TTL 过滤 · 再按时间戳降序保留 MAX
    if (m.size > this.MAX_PER_ACCOUNT) {
      this.gc(accountId);
    }
  }

  private gc(accountId: number): void {
    const m = this.cache.get(accountId);
    if (!m) return;
    const now = Date.now();
    // 先删 TTL 过期的
    for (const [k, v] of m.entries()) {
      if (now - v.timestamp > this.TTL_MS) m.delete(k);
    }
    // 还超 · 按 timestamp 降序保留 MAX
    if (m.size > this.MAX_PER_ACCOUNT) {
      const arr = [...m.entries()].sort((a, b) => b[1].timestamp - a[1].timestamp);
      m.clear();
      for (const [k, v] of arr.slice(0, this.MAX_PER_ACCOUNT)) {
        m.set(k, v);
      }
    }
  }

  /** 获取最近 N 条 status · 按时间降序 · 可选过滤未看过/未点赞 */
  list(
    accountId: number,
    opts: { limit?: number; onlyUnviewed?: boolean; onlyUnreacted?: boolean } = {},
  ): CachedStatus[] {
    const m = this.cache.get(accountId);
    if (!m) return [];
    const now = Date.now();
    let arr = [...m.values()].filter((v) => now - v.timestamp <= this.TTL_MS);
    if (opts.onlyUnviewed) arr = arr.filter((v) => !v.viewed);
    if (opts.onlyUnreacted) arr = arr.filter((v) => !v.reacted);
    arr.sort((a, b) => b.timestamp - a.timestamp);
    return arr.slice(0, opts.limit ?? 50);
  }

  markViewed(accountId: number, key: WAMessageKey): void {
    const keyStr = `${key.remoteJid}|${key.id}`;
    const m = this.cache.get(accountId);
    const v = m?.get(keyStr);
    if (v) v.viewed = true;
  }

  markReacted(accountId: number, key: WAMessageKey): void {
    const keyStr = `${key.remoteJid}|${key.id}`;
    const m = this.cache.get(accountId);
    const v = m?.get(keyStr);
    if (v) v.reacted = true;
  }

  /** 打扫账号的所有 cache · 注销时调 */
  clearAccount(accountId: number): void {
    this.cache.delete(accountId);
  }

  /** 统计 · 用于 dashboard / debug */
  stats(accountId: number): { total: number; unviewed: number; unreacted: number } {
    const m = this.cache.get(accountId);
    if (!m) return { total: 0, unviewed: 0, unreacted: 0 };
    let total = 0;
    let unviewed = 0;
    let unreacted = 0;
    const now = Date.now();
    for (const v of m.values()) {
      if (now - v.timestamp > this.TTL_MS) continue;
      total++;
      if (!v.viewed) unviewed++;
      if (!v.reacted) unreacted++;
    }
    return { total, unviewed, unreacted };
  }
}
