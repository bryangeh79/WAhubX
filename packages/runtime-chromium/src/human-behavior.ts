// 2026-04-25 · D7-1 · 行为模拟全套 (FAhubX HumanBehaviorSimulator 移植 · 适配 WA Web)
//
// 范围 (Codex 拍板):
//   - 实装全 6 方法 (W2 sendText 用得上)
//   - D7-1 默认只启用 simulateRandomScroll + 轻量 simulateMouseMovement
//   - simulateHumanTyping / simulateHumanClick 留给 W2 sendText 调
//
// 不在 D7-1 范围:
//   - WA Web sendText / open chat / focus input · 不点不输入 (Codex 锁)
//   - WebGL / Canvas 噪声 (D8+)
//
// 跨平台: 纯 puppeteer-core API · Windows / Linux 都行 · 不依赖 docker

import type { Page, ElementHandle } from 'puppeteer-core';

export interface HumanBehaviorOptions {
  /** 鼠标弧线步数 · 默认 20 · FAhubX 原值 */
  mouseSteps?: number;
  /** 鼠标移动 jitter · 默认 ±5px */
  mouseJitterPx?: number;
  /** 打字速度档位 (ms/字符 范围) */
  typingSpeed?: 'slow' | 'normal' | 'fast';
  /** 模拟打错概率 · 默认 0.05 */
  typoProbability?: number;
}

const DEFAULTS: Required<HumanBehaviorOptions> = {
  mouseSteps: 20,
  mouseJitterPx: 5,
  typingSpeed: 'normal',
  typoProbability: 0.05,
};

const TYPING_RANGES: Record<'slow' | 'normal' | 'fast', [number, number]> = {
  slow: [80, 200],   // 60-150 字/分钟
  normal: [40, 130], // 100-200 字/分钟
  fast: [25, 80],    // 200-400 字/分钟
};

const TYPO_CHARS = 'abcdefghijklmnopqrstuvwxyz';

/**
 * 行为模拟工具 · 单 page 实例一份
 */
export class HumanBehaviorSimulator {
  private opts: Required<HumanBehaviorOptions>;
  private currentMouseX = 100;
  private currentMouseY = 100;

  constructor(
    private page: Page,
    options: HumanBehaviorOptions = {},
  ) {
    this.opts = { ...DEFAULTS, ...options };
  }

  /**
   * Gaussian-jittered 延迟 · 中心聚集 · 比 uniform random 像真人
   * FAhubX 用 100-3000ms · 我们保持一致
   */
  async randomDelay(minMs: number, maxMs: number): Promise<void> {
    // Box-Muller transform · 中心聚集
    const u1 = Math.random();
    const u2 = Math.random();
    const gauss = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    // gauss ~ N(0, 1) · 截断到 [-2, 2] 然后映射到 [min, max]
    const clamped = Math.max(-2, Math.min(2, gauss));
    const ratio = (clamped + 2) / 4; // [0, 1]
    const ms = Math.round(minMs + ratio * (maxMs - minMs));
    await new Promise((r) => setTimeout(r, ms));
  }

  /**
   * 鼠标弧线移动 · 20 步插值 + 5px jitter · FAhubX 算法
   * 不直接跳 · 让 WA Web 看到 mousemove 事件流
   */
  async simulateMouseMovement(targetX: number, targetY: number): Promise<void> {
    const startX = this.currentMouseX;
    const startY = this.currentMouseY;
    const steps = this.opts.mouseSteps;
    const jitter = this.opts.mouseJitterPx;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      // bezier 曲线 (二次) · 加随机弧度
      const ease = t * t * (3 - 2 * t); // smooth-step
      const baseX = startX + (targetX - startX) * ease;
      const baseY = startY + (targetY - startY) * ease;
      const jitterX = (Math.random() - 0.5) * jitter * 2;
      const jitterY = (Math.random() - 0.5) * jitter * 2;
      const x = baseX + jitterX;
      const y = baseY + jitterY;

      try {
        await this.page.mouse.move(x, y);
      } catch {
        return; // page closed
      }
      // 每步 5-15ms · 模拟手速
      await new Promise((r) => setTimeout(r, 5 + Math.random() * 10));
    }
    this.currentMouseX = targetX;
    this.currentMouseY = targetY;
  }

  /**
   * 人类点击 · 移动 → 50-200ms 暂停 → 按下 → 释放
   * 不在 D7-1 idle 用 · 留给 W2 sendText
   */
  async simulateHumanClick(element: ElementHandle): Promise<void> {
    const box = await element.boundingBox();
    if (!box) return;

    // 点击中心 + 微随机
    const targetX = box.x + box.width / 2 + (Math.random() - 0.5) * Math.min(box.width / 4, 20);
    const targetY = box.y + box.height / 2 + (Math.random() - 0.5) * Math.min(box.height / 4, 10);

    await this.simulateMouseMovement(targetX, targetY);
    // 移动到目标后稍停 · 模拟人确认目标
    await this.randomDelay(50, 200);

    try {
      await this.page.mouse.down();
      // 按下到释放之间 30-100ms · 真人按压
      await new Promise((r) => setTimeout(r, 30 + Math.random() * 70));
      await this.page.mouse.up();
    } catch {
      /* page closed · ignore */
    }
  }

  /**
   * 人类打字 · 30-150ms/字符 · 5% 概率打错回退
   * 不在 D7-1 idle 用 · 留给 W2 sendText
   */
  async simulateHumanTyping(text: string): Promise<void> {
    const [minDelay, maxDelay] = TYPING_RANGES[this.opts.typingSpeed];

    // 2026-04-28 · 修致命 bug · WA Web 里 \n 直接触发发送 · 必须 Shift+Enter 才是消息内换行
    // 老代码 keyboard.type('\n') 会把多行广告拆成多条独立消息 · 客户体验毁灭
    // 同时 \r\n 标准化成 \n 防 Windows 文件遗留 \r 误触发
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    for (const ch of normalized) {
      // 换行: Shift+Enter (WA Web 软换行 · 不发送)
      if (ch === '\n') {
        try {
          await this.page.keyboard.down('Shift');
          await this.page.keyboard.press('Enter');
          await this.page.keyboard.up('Shift');
        } catch {
          return;
        }
        await this.randomDelay(minDelay, maxDelay);
        continue;
      }

      // 5% 概率模拟打错 · 输个邻近字符然后退格
      if (Math.random() < this.opts.typoProbability) {
        const wrong = TYPO_CHARS[Math.floor(Math.random() * TYPO_CHARS.length)];
        try {
          await this.page.keyboard.type(wrong);
          await this.randomDelay(100, 400);
          await this.page.keyboard.press('Backspace');
          await this.randomDelay(50, 150);
        } catch {
          return;
        }
      }

      try {
        await this.page.keyboard.type(ch);
      } catch {
        return;
      }
      await this.randomDelay(minDelay, maxDelay);
    }
  }

  /**
   * 随机滚动 · 70% 概率触发 · 100-600px (FAhubX 原值)
   * D7-1 idle 默认调用此
   */
  async simulateRandomScroll(): Promise<void> {
    if (Math.random() > 0.7) return; // 30% 概率不滚

    const direction = Math.random() < 0.5 ? -1 : 1; // 上下随机
    const distance = (100 + Math.random() * 500) * direction;

    try {
      // 优先滚 chat-list pane · 不滚整页 (WA Web 整页不滚)
      await this.page.evaluate((d: number) => {
        const sel = '[data-testid="chat-list"], #pane-side';
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el && el.scrollBy) {
          el.scrollBy({ top: d, behavior: 'smooth' });
        } else {
          window.scrollBy({ top: d, behavior: 'smooth' });
        }
      }, distance);
    } catch {
      /* ignore */
    }
  }

  /**
   * 综合"浏览"行为 · 在 chat-list 区域随机走 · D7-1 idle 默认调
   * 组合: 缓慢鼠标移动 + 偶尔小幅滚 · 不点不输不打开聊天
   */
  async simulateBrowsingBehavior(): Promise<void> {
    // 1. 找 chat-list pane bbox · 没的话 fallback 到视口
    let bounds = { x: 0, y: 0, w: 1280, h: 800 };
    try {
      const result = await this.page.evaluate(() => {
        const el = document.querySelector(
          '[data-testid="chat-list"], #pane-side',
        ) as HTMLElement | null;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      });
      if (result) bounds = result;
    } catch {
      /* fallback to viewport */
    }

    // 2. 鼠标移到该区域随机点 · 缓慢
    const targetX = bounds.x + 30 + Math.random() * Math.max(1, bounds.w - 60);
    const targetY = bounds.y + 30 + Math.random() * Math.max(1, bounds.h - 60);
    await this.simulateMouseMovement(targetX, targetY);

    // 3. 短暂停留
    await this.randomDelay(300, 1200);

    // 4. 偶尔轻滚
    await this.simulateRandomScroll();
  }
}
