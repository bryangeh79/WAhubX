// 2026-04-25 · D7-1 · 客服号 idle 行为调度器 (Codex 拍板低强度)
//
// 目的: 客服号 always-on 24/7 · WA 看到的"页面在用"信号需要存在 · 但不能过头.
// 真客服画像: "网页挂着 · 偶尔有人看" · 不是 "机器人在乱操作".
//
// Codex 拍板默认动作池 (D7-1 范围):
//   ✓ 小幅滚动 (chat-list pane)
//   ✓ 鼠标缓慢移动 (chat-list 区域)
//   ✓ 偶尔 focus/blur (visibility cycle)
//   ✓ 2026-04-29 P0-CS-3 · tab-switch (read-only 切 chat-list 顶部 Tab All→Unread→All)
//   ✗ 不点击发送相关
//   ✗ 不打开新聊天 (peek-chat 评估后不加 · 影响 watcher)
//   ✗ 不触发输入框 (typing presence 评估后不加 · 信号太强)
//
// 触发条件 (Codex 拍板):
//   - 仅在 page state = chat-list 时
//   - 间隔 5-15 分钟 (light 默认 · 兼容老行为) / 3-8 分钟 (normal) / 2-5 分钟 (heavy 实验)
//   - HUMAN_BEHAVIOR_ENABLED=false 完全关闭 (soak A/B 用)
//
// 2026-04-29 · P0-CS-3 · level 设计:
//   HUMAN_BEHAVIOR_LEVEL=off    完全关闭 (等价于 HUMAN_BEHAVIOR_ENABLED=false)
//   HUMAN_BEHAVIOR_LEVEL=light  默认 · 5-15min · browse/scroll/focus + 偶尔 tab-switch
//   HUMAN_BEHAVIOR_LEVEL=normal 3-8min · 同动作池 · tab-switch 占比提升
//   HUMAN_BEHAVIOR_LEVEL=heavy  2-5min · 实验性 · 不自动启用 · 仅手动 env 测试
//
// 默认行为不变 · 老用户不指定 env 时仍是 light 5-15min · 完全向后兼容.
//
// 日志统一 tag: behavior.simulated · 方便 soak 数据排查

import type { Page } from 'puppeteer-core';
import type { Logger } from 'pino';
import { HumanBehaviorSimulator } from './human-behavior';
import { findFirstMatch, WA_SELECTORS } from './wa-web/wa-web-selectors';

export type BehaviorLevel = 'off' | 'light' | 'normal' | 'heavy';

export interface IdleActivityOptions {
  page: Page;
  log: Logger;
  /** 默认 5 min · level=light 时使用 · level=normal/heavy 会自动覆盖 */
  minIntervalMs?: number;
  /** 默认 15 min · level=light 时使用 · level=normal/heavy 会自动覆盖 */
  maxIntervalMs?: number;
  /** 默认 true · 设 false 整体不调度 (soak A/B 对照用) · 等价 level='off' */
  enabled?: boolean;
  /** 2026-04-29 · P0-CS-3 · 行为强度档位 · 不传或 undefined → 读 env HUMAN_BEHAVIOR_LEVEL · 仍 undefined → 'light' */
  level?: BehaviorLevel;
}

const DEFAULT_MIN_MS = 5 * 60 * 1000;
const DEFAULT_MAX_MS = 15 * 60 * 1000;

// 2026-04-29 · P0-CS-3 · level 阈值表
const LEVEL_PROFILES: Record<BehaviorLevel, { minMs: number; maxMs: number; tabSwitchProb: number }> = {
  off:    { minMs: 0,             maxMs: 0,              tabSwitchProb: 0 },
  light:  { minMs: 5 * 60 * 1000,  maxMs: 15 * 60 * 1000, tabSwitchProb: 0.10 }, // 老行为 + 10% tab-switch
  normal: { minMs: 3 * 60 * 1000,  maxMs: 8 * 60 * 1000,  tabSwitchProb: 0.20 },
  heavy:  { minMs: 2 * 60 * 1000,  maxMs: 5 * 60 * 1000,  tabSwitchProb: 0.25 }, // 实验性 · 不推荐
};

function resolveLevel(opts: IdleActivityOptions): BehaviorLevel {
  if (opts.enabled === false) return 'off';
  if (opts.level) return opts.level;
  const envRaw = (process.env.HUMAN_BEHAVIOR_LEVEL ?? '').toLowerCase().trim();
  if (envRaw === 'off' || envRaw === 'light' || envRaw === 'normal' || envRaw === 'heavy') {
    return envRaw;
  }
  return 'light'; // 默认向后兼容
}

type ActionType = 'browse' | 'scroll-only' | 'focus-cycle' | 'tab-switch';

export class IdleActivityScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private simulator: HumanBehaviorSimulator;
  private actionCount = 0;
  private skippedNotChatList = 0;

  constructor(private opts: IdleActivityOptions) {
    this.simulator = new HumanBehaviorSimulator(opts.page);
  }

  start(): void {
    // 2026-04-29 · P0-CS-3 · 解析 level (env / opts.level / 默认 light)
    const level = resolveLevel(this.opts);
    if (level === 'off') {
      this.opts.log.info(
        { tag: 'behavior.simulated', level: 'off' },
        'D7-1 idle activity scheduler · DISABLED (level=off · HUMAN_BEHAVIOR_LEVEL=off 或 enabled=false)',
      );
      return;
    }
    if (this.running) return;
    this.running = true;

    // 老 minIntervalMs / maxIntervalMs 仍优先 (soak 测试可强制) · 否则按 level
    const profile = LEVEL_PROFILES[level];
    const minMs = this.opts.minIntervalMs ?? profile.minMs;
    const maxMs = this.opts.maxIntervalMs ?? profile.maxMs;

    this.opts.log.info(
      { tag: 'behavior.simulated', level, minMs, maxMs, tabSwitchProb: profile.tabSwitchProb },
      `D7-1 idle activity scheduler · STARTED · level=${level} · 客服号活性维持`,
    );

    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.opts.log.info(
      { tag: 'behavior.simulated', actionCount: this.actionCount, skipped: this.skippedNotChatList },
      'D7-1 idle activity scheduler · STOPPED',
    );
  }

  private scheduleNext(): void {
    if (!this.running) return;
    // 2026-04-29 · P0-CS-3 · 用 level profile · 老 opts.min/maxIntervalMs 保留覆盖能力
    const level = resolveLevel(this.opts);
    const profile = LEVEL_PROFILES[level];
    const minMs = this.opts.minIntervalMs ?? profile.minMs ?? DEFAULT_MIN_MS;
    const maxMs = this.opts.maxIntervalMs ?? profile.maxMs ?? DEFAULT_MAX_MS;
    const next = minMs + Math.random() * (maxMs - minMs);

    this.timer = setTimeout(() => {
      void this.tick();
    }, next);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    try {
      // 1. 仅在 chat-list 状态触发 · 防 qr / splash / 异常状态下乱动
      const chatM = await findFirstMatch(this.opts.page, WA_SELECTORS.chatList);
      if (!chatM.found) {
        this.skippedNotChatList += 1;
        this.opts.log.info(
          { tag: 'behavior.simulated', reason: 'not-chat-list', skipped: this.skippedNotChatList },
          'idle activity skipped · page state not chat-list',
        );
        this.scheduleNext();
        return;
      }

      // 2. 从动作池随机挑 (低强度子集)
      const action = this.pickAction();
      const startedAt = Date.now();

      try {
        await this.executeAction(action);
        this.actionCount += 1;
        this.opts.log.info(
          {
            tag: 'behavior.simulated',
            action,
            durationMs: Date.now() - startedAt,
            actionCount: this.actionCount,
          },
          `idle action executed: ${action}`,
        );
      } catch (err) {
        this.opts.log.warn(
          {
            tag: 'behavior.simulated',
            action,
            err: err instanceof Error ? err.message : err,
          },
          'idle action failed · 不影响主流程',
        );
      }
    } finally {
      this.scheduleNext();
    }
  }

  private pickAction(): ActionType {
    // 2026-04-29 · P0-CS-3 · level 决定 tab-switch 占比 · 其余 90%/80%/75% 走老动作池
    const level = resolveLevel(this.opts);
    const profile = LEVEL_PROFILES[level];
    const r = Math.random();
    if (r < profile.tabSwitchProb) return 'tab-switch';
    // 剩余按老比例 (browse 60% / scroll 30% / focus 10%)
    const r2 = Math.random();
    if (r2 < 0.6) return 'browse';
    if (r2 < 0.9) return 'scroll-only';
    return 'focus-cycle';
  }

  private async executeAction(action: ActionType): Promise<void> {
    switch (action) {
      case 'browse':
        await this.simulator.simulateBrowsingBehavior();
        return;
      case 'scroll-only':
        await this.simulator.simulateRandomScroll();
        return;
      case 'focus-cycle':
        await this.fireFocusCycle();
        return;
      case 'tab-switch':
        await this.fireTabSwitch();
        return;
    }
  }

  /**
   * 2026-04-29 · P0-CS-3 · tab-switch · 切 chat-list 顶部过滤 Tab
   *
   * WA Web chat-list 顶部有 [All / Unread / Favourites / Groups] 过滤 chip
   * 真用户经常 All → Unread (看新消息) → All (恢复)
   *
   * 严格 read-only: 只点过滤 Tab · 不点聊天 · 不打开输入框 · 不发消息
   * 安全设计:
   *   - 仅在能找到至少 2 个 Tab 时执行
   *   - 找不到对应 button 静默跳过
   *   - 异常时 ESC + 跳过 (page closed / DOM 变化等)
   *   - 每次只切换 1 次往返 (All → 其他 → All)
   */
  private async fireTabSwitch(): Promise<void> {
    try {
      // 1. 找 chat-list 顶部 filter chip · 用多策略 selector (WA DOM 时不时改)
      const result = await this.opts.page.evaluate(() => {
        const FILTER_SELECTORS = [
          'button[aria-label*="Unread" i]',
          '[role="tab"][aria-label*="Unread" i]',
          'button[role="tab"]:not([aria-selected="true"])',
        ];
        const ALL_SELECTORS = [
          'button[aria-label*="All" i][role="tab"]',
          '[role="tab"][aria-label*="All chats" i]',
          'button[role="tab"][aria-selected="true"]',
        ];

        const findFirst = (sels: string[]): { found: boolean; selectorUsed?: string } => {
          for (const s of sels) {
            const el = document.querySelector(s);
            if (el) return { found: true, selectorUsed: s };
          }
          return { found: false };
        };

        const unread = findFirst(FILTER_SELECTORS);
        const all = findFirst(ALL_SELECTORS);
        return {
          unreadFound: unread.found,
          unreadSelector: unread.selectorUsed ?? null,
          allFound: all.found,
          allSelector: all.selectorUsed ?? null,
        };
      });

      if (!result.unreadFound || !result.allFound) {
        this.opts.log.info(
          { tag: 'behavior.simulated', action: 'tab-switch', skipped: true, reason: 'tab-not-found', diag: result },
          'tab-switch skipped · filter tabs not found in DOM',
        );
        return;
      }

      // 2. 切到 Unread (用 selector 直接 click · 不模拟鼠标轨迹 · 因为是 read-only filter 不需要)
      await this.opts.page.evaluate((sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el) el.click();
      }, result.unreadSelector!);

      // 3. 停 1-3s 模拟"看一眼"
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));

      // 4. 切回 All
      await this.opts.page.evaluate((sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el) el.click();
      }, result.allSelector!);

      // 5. 短停 200-500ms 让 DOM 稳定
      await new Promise((r) => setTimeout(r, 200 + Math.random() * 300));
    } catch (err) {
      // page closed / DOM detached · 静默
      this.opts.log.warn(
        { tag: 'behavior.simulated', action: 'tab-switch', err: err instanceof Error ? err.message : err },
        'tab-switch failed · 不影响主流程',
      );
    }
  }

  /**
   * focus/blur cycle · 模拟"用户切到别的 tab 又回来"
   * 不真切 tab (puppeteer 多 page 不实用) · 用 visibility event
   */
  private async fireFocusCycle(): Promise<void> {
    try {
      await this.opts.page.evaluate(() => {
        // 触发 visibilitychange · 模拟 tab 隐藏
        try {
          Object.defineProperty(document, 'visibilityState', {
            value: 'hidden',
            configurable: true,
          });
          Object.defineProperty(document, 'hidden', {
            value: true,
            configurable: true,
          });
          document.dispatchEvent(new Event('visibilitychange'));
        } catch {
          /* ignore */
        }
      });
      // 隐藏 2-8 秒后回来
      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 6000));
      await this.opts.page.evaluate(() => {
        try {
          Object.defineProperty(document, 'visibilityState', {
            value: 'visible',
            configurable: true,
          });
          Object.defineProperty(document, 'hidden', {
            value: false,
            configurable: true,
          });
          document.dispatchEvent(new Event('visibilitychange'));
        } catch {
          /* ignore */
        }
      });
    } catch {
      /* ignore · page closed */
    }
  }
}
