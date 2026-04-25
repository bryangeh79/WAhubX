// 2026-04-25 · WA Web DOM selector 多策略池
//
// 设计原则 (POC 锁边界 § 4.1):
//   - 不用 emotion CSS hash class (e.g. .x123abc) · 易碎
//   - 优先 data-testid → aria-label → role + structure
//   - 每个状态多 fallback 选择器 · 顺序尝试
//   - 集中此文件 · selector 失效时只改一处
//
// 当前 D2 仅识别 2 状态: qr / chat-list (POC 锁定 · 不扩状态机)

export const WA_SELECTORS = {
  // QR 扫码画布 · 未登录态唯一标志
  qrCanvas: [
    'canvas[aria-label*="Scan"]',
    'canvas[aria-label*="scan"]',
    'div[data-ref] canvas',
    'div[data-testid="qrcode"] canvas',
  ],

  // 已登录主界面 · chat-list 出现表示恢复 session 成功
  chatList: [
    '[data-testid="chat-list"]',
    'div[role="grid"][aria-label*="Chat"]',
    'div[role="listbox"][aria-label*="Chat"]',
    '#pane-side',
  ],

  // 启动初期通用 · 'Loading your chats' / WhatsApp logo splash
  // 注: 'splash' 检测以 css var 为主 (D4 法医证实 selector 池里 testid 不一定渲染)
  splash: [
    'div[data-testid="intro-md-beta-logo-dark"]',
    'div[data-testid="intro-md-beta-logo-light"]',
    'div[data-testid="splash-screen"]',
    '[class*="_aig0"]', // splash 核心容器 emotion class fragment (D4 法医补)
  ],

  // 2026-04-25 · D4 法医新发现: WA "你浏览器不支持" 降级页
  // 检测 class*= 关键 fragment + 特定文字 (不限版本)
  unsupportedLanding: [
    '[class*="landing-wrapper"]',
    '[class*="landing-headerTitle"]',
    '[class*="version-title"]',
  ],
};

// D4 · splash 持续阈值 · splash 见到后超过这时间仍无 qr/chat-list → 标 splash-stuck
export const SPLASH_STUCK_THRESHOLD_MS = 30_000;

/**
 * 在 page 内尝试匹配第一个命中的 selector
 * 用 page.$ 不是 page.waitForSelector · 立即返回不阻塞
 */
export async function findFirstMatch(
  page: import('puppeteer-core').Page,
  selectors: string[],
): Promise<{ selector: string; found: boolean }> {
  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.dispose();
        return { selector: sel, found: true };
      }
    } catch {
      // 单个 selector 失败 · 试下一个
    }
  }
  return { selector: selectors[0], found: false };
}
