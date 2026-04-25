// 2026-04-25 · D7-1 · 客服号 idle 行为调度器 (Codex 拍板低强度)
//
// 目的: 客服号 always-on 24/7 · WA 看到的"页面在用"信号需要存在 · 但不能过头.
// 真客服画像: "网页挂着 · 偶尔有人看" · 不是 "机器人在乱操作".
//
// Codex 拍板默认动作池 (D7-1 范围):
//   ✓ 小幅滚动 (chat-list pane)
//   ✓ 鼠标缓慢移动 (chat-list 区域)
//   ✓ 偶尔 focus/blur (visibility cycle)
//   ✗ 不点击发送相关
//   ✗ 不打开新聊天
//   ✗ 不触发输入框
//
// 触发条件 (Codex 拍板):
//   - 仅在 page state = chat-list 时
//   - 间隔 5-15 分钟 (随机)
//   - HUMAN_BEHAVIOR_ENABLED=false 完全关闭 (soak A/B 用)
//
// 日志统一 tag: behavior.simulated · 方便 soak 数据排查

import type { Page } from 'puppeteer-core';
import type { Logger } from 'pino';
import { HumanBehaviorSimulator } from './human-behavior';
import { findFirstMatch, WA_SELECTORS } from './wa-web/wa-web-selectors';

export interface IdleActivityOptions {
  page: Page;
  log: Logger;
  /** 默认 5 min */
  minIntervalMs?: number;
  /** 默认 15 min */
  maxIntervalMs?: number;
  /** 默认 true · 设 false 整体不调度 (soak A/B 对照用) */
  enabled?: boolean;
}

const DEFAULT_MIN_MS = 5 * 60 * 1000;
const DEFAULT_MAX_MS = 15 * 60 * 1000;

type ActionType = 'browse' | 'scroll-only' | 'focus-cycle';

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
    if (this.opts.enabled === false) {
      this.opts.log.info(
        { tag: 'behavior.simulated', enabled: false },
        'D7-1 idle activity scheduler · DISABLED via env (HUMAN_BEHAVIOR_ENABLED=false)',
      );
      return;
    }
    if (this.running) return;
    this.running = true;

    const minMs = this.opts.minIntervalMs ?? DEFAULT_MIN_MS;
    const maxMs = this.opts.maxIntervalMs ?? DEFAULT_MAX_MS;

    this.opts.log.info(
      { tag: 'behavior.simulated', minMs, maxMs },
      'D7-1 idle activity scheduler · STARTED · 客服号低强度活性维持',
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
    const minMs = this.opts.minIntervalMs ?? DEFAULT_MIN_MS;
    const maxMs = this.opts.maxIntervalMs ?? DEFAULT_MAX_MS;
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
    // 60% 综合浏览 (鼠标 + 偶尔滚) · 30% 仅滚 · 10% focus cycle
    const r = Math.random();
    if (r < 0.6) return 'browse';
    if (r < 0.9) return 'scroll-only';
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
