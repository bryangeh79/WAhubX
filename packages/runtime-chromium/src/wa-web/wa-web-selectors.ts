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

  // 2026-04-25 · D10 W2 · 发消息相关 selector
  // 进 chat 后的消息输入框 (contenteditable)
  // WA Web 用 div[contenteditable=true] 不是 textarea
  messageInput: [
    'div[contenteditable="true"][data-tab="10"]',           // 当前主流 · data-tab=10 是消息输入
    'div[contenteditable="true"][role="textbox"][title*="essag"]', // i18n: Type a message / Message
    'footer div[contenteditable="true"]',                   // footer 内的可编辑区
    'div[contenteditable="true"][data-testid="conversation-compose-box-input"]',
  ],

  // 发送按钮 (paperplane icon) · 但通常我们用 Enter 键 · 这里留 fallback
  sendButton: [
    'button[data-tab="11"]',                                // 主流 · paperplane
    'button[aria-label*="Send"]',                           // i18n: Send / Enviar
    'button[data-testid="compose-btn-send"]',
    'span[data-icon="send"]',                               // icon span 直接点也行
  ],

  // 附件按钮 (paperclip · 弹出 image/video/document/etc)
  attachButton: [
    'button[title*="Attach"]',                              // i18n
    'div[title*="Attach"]',
    'span[data-icon="plus-rounded"]',                       // 新版 + 号
    'span[data-icon="attach-menu-plus"]',
    'span[data-icon="clip"]',                               // 旧版 paperclip
    'button[aria-label*="Attach"]',
  ],

  // 附件菜单弹出后 · 各类文件 input
  attachImageInput: [
    'input[accept*="image"]',
    'button[aria-label*="Photo"] input',
    'span[data-icon="image"] input',
  ],

  attachDocumentInput: [
    // 2026-04-25 · P0.5/P0.6 修 T2.5 file · 现代 WA Web 多种 accept 形态
    'input[accept="*"]',                                    // 文档默认 accept=* (旧版)
    'input[accept="*/*"]',                                  // accept=*/* 形态
    'input[type="file"][accept=""]',                        // 空 accept
    'input[type="file"]:not([accept])',                     // 无 accept 属性 (现代 WA · "Document" 项)
    'input[type="file"]:not([accept*="image"]):not([accept*="video"]):not([accept*="audio"])',
    'span[data-icon="document"] input',
    'span[data-icon="document-refreshed"] input',           // 新版 icon 名带 -refreshed 后缀
  ],

  // 2026-04-26 · P0.7 · attach 菜单里的 "Document" / "文档" item · 必须先 click 这个 · 才会激活真 file input
  // image 路径不需要这步 (image input 一打 attach 就有 active handler · 直接 uploadFile)
  // file 路径必须 click "Document" menu item · WA Web React onChange handler 才挂上
  attachDocumentMenuItem: [
    'li[aria-label*="Document"]',                           // 老版 menu list
    'li[aria-label*="文档"]',                                // 中文
    'li[aria-label*="Documento"]',                          // ES/PT
    '[role="menuitem"][aria-label*="Document"]',            // 新版 role
    '[role="menuitem"][aria-label*="文档"]',
    'div[aria-label*="Document"][role="button"]',           // 新版 button 形
    'button[aria-label*="Document"]',
    'button[aria-label*="文档"]',
    'span[data-icon="document"]',                           // icon 父节点 (clickable 通常)
    'span[data-icon="document-refreshed"]',
  ],

  // 发送状态 · 单勾 (已发) / 双勾 (已送达) / 蓝勾 (已读)
  // D10 sendText 单勾即认成功 (Codex 锁: 不做"等已送达确认")
  messageStatusTick: [
    'span[data-icon="msg-check"]',                          // 单勾 (sent)
    'span[data-icon="msg-time"]',                           // pending (clock icon)
    'span[data-icon="msg-dblcheck"]',                       // 双勾 (delivered)
    'span[data-icon="msg-dblcheck-light"]',                 // 双勾蓝 (read)
  ],

  // ═══ 2026-04-26 · P0.11 高保真 inbound · 进 chat / 读消息 / 退 chat ═══

  // chat detail header (进 chat 后顶部) · 含对方名 + status
  chatHeader: [
    'header[data-testid="conversation-header"]',
    'header[data-testid*="header"]',
    'div[data-testid="conversation-info-header"]',
    '#main header',
    'header',
  ],

  // chat detail header 里对方显示名 · saved contact name 或 phone
  chatHeaderTitle: [
    'header [data-testid="conversation-info-header-chat-title"]',
    'header span[dir="auto"][title]',
    'header span[dir="auto"]',
  ],

  // 消息列表容器 (chat detail 中段)
  messageList: [
    'div[data-testid="conversation-panel-messages"]',
    'div[data-testid="msg-list"]',
    '#main div[role="region"]',
    '#main div[role="application"]',
    '#main',
  ],

  // 单条消息 bubble · 优先有 data-id 的
  // data-id 形如 "false_60186888168@c.us_3EB0...HASH" (false=in / true=out)
  messageBubble: [
    'div[data-testid*="msg-container"]',
    'div[data-id]:not([role="listitem"])',
    'div[role="row"]',
  ],

  // 消息文本 (selectable-text · WA Web 标 emotion class)
  messageText: [
    'div[data-testid="msg-text"]',
    'span.selectable-text',
    'span[class*="selectable-text"]',
  ],

  // 消息时间戳 (visible 在 bubble 角)
  messageTimestamp: [
    'div[data-testid="msg-meta"] span',
    'span[data-testid*="meta"]',
    'span[class*="message-time"]',
  ],

  // chat detail 退出按钮 (移动 / narrow viewport)
  chatBackButton: [
    'button[aria-label*="Back"]',
    'span[data-icon="back"]',
  ],
  chatCloseButton: [
    'button[aria-label*="Close"]',
    'span[data-icon="x"]',
  ],

  // ═══ 2026-04-26 · D11 · WA Status (动态/Story) selectors ═══
  // 注: 未实测 · 上线前需 chromium devtools 用真号校准 · 写多 fallback 抗 WA Web 版本漂移

  // 左侧栏 Status 按钮 (icon · 大概率独立按钮 / aria-label)
  statusTabButton: [
    'button[aria-label="Status"]',
    'button[aria-label="状态"]',
    'div[aria-label="Status"][role="button"]',
    'div[aria-label="状态"][role="button"]',
    'span[data-icon="status-outline"]',
    'span[data-icon="status-refreshed"]',
    'span[data-icon="status"]',
    '[data-testid="status-tab"]',
  ],

  // Status 列表里 "我的状态" / "My status" 第一项
  myStatusItem: [
    'div[aria-label*="My status"]',
    'div[aria-label*="我的状态"]',
    'div[role="button"][title*="My status"]',
    'div[role="button"][title*="我的状态"]',
    'span[data-icon="status-add"]',
  ],

  // 添加 status 按钮 (悬浮 ➕ / 笔形等 · 可能在 my-status 区域)
  addStatusButton: [
    'div[aria-label*="Add Status"]',
    'div[aria-label*="添加状态"]',
    'span[data-icon="plus-light"]',
    'span[data-icon="status-add"]',
    'span[data-icon="text-status"]',  // 老版直接 "T" 按钮发文字
    'button[aria-label*="text status"]',
  ],

  // 文字 status 编辑容器 (contenteditable)
  statusTextInput: [
    'div[contenteditable="true"][role="textbox"][data-tab*="status"]',
    'div[contenteditable="true"][aria-label*="status"]',
    'div[contenteditable="true"][aria-label*="状态"]',
    'div[contenteditable="true"]', // fallback (可能多个 · 取第一个 visible 的)
  ],

  // status 编辑器内"发送"按钮
  statusSendButton: [
    'button[aria-label*="Send"]',
    'button[aria-label*="发送"]',
    'span[data-icon="send"]',
    'div[role="button"][aria-label*="Send"]',
  ],

  // status 列表里"最近更新" section heading (用于定位下方未读 items)
  recentUpdatesSection: [
    'div[aria-label*="Recent updates"]',
    'div[aria-label*="最近更新"]',
    'div[aria-label*="Recent"]',
  ],

  // status 列表中单条他人 status item (可点击 → 进 viewer)
  // 通常是带 author 名字的 row · role=button
  statusListItem: [
    '[data-testid*="status-item"]',
    'div[role="button"][tabindex="0"][aria-label*="status"]',
    'div[role="button"][tabindex="0"][aria-label*="动态"]',
    'div[role="button"][tabindex="0"][aria-label*="状态"]',
    // fallback: status panel 内的可点击行
    'div[data-testid="status-list"] div[role="button"]',
  ],

  // status viewer 进入后 · 关闭/退出按钮 (X)
  statusViewerCloseButton: [
    'button[aria-label*="Close"]',
    'span[data-icon="x"]',
    'span[data-icon="x-viewer"]',
  ],

  // status viewer 内 react/reply 输入框 (底部 reply input)
  // 在 viewer 内底部输入文字 · WA 视为 reply (类似 IG stories reply)
  statusReplyInput: [
    'div[contenteditable="true"][aria-label*="Reply"]',
    'div[contenteditable="true"][aria-label*="回复"]',
    'div[contenteditable="true"][role="textbox"]',
    'footer div[contenteditable="true"]',
  ],

  // status viewer 内 emoji react 按钮 (笑脸 icon)
  statusReactButton: [
    'button[aria-label*="React"]',
    'button[aria-label*="表情"]',
    'span[data-icon="smiley-status"]',
    'span[data-icon="smiley"]',
    'div[role="button"][aria-label*="React"]',
  ],

  // emoji picker 内某个 emoji (动态选 · 只用 'thumbs up' 为默认)
  // WA Web emoji picker 用 emoji 字符自身做 aria-label · 也用 emoji name
  emojiThumbsUp: [
    'button[aria-label*="thumbs up"]',
    'button[aria-label*="Thumbs up"]',
    'button[aria-label*="赞"]',
    'button[aria-label="👍"]',
    '[data-name*="thumbsup"]',
    '[data-name*="thumbs_up"]',
  ],

  // ═══ 2026-04-26 · D11 · Profile 编辑 selectors ═══

  // 顶部头像按钮 (点开 profile pane)
  selfProfileAvatar: [
    'header div[role="button"][title*="Profile"]',
    'header div[role="button"][title*="个人资料"]',
    'header div[data-testid="default-user"]',
    'header img[src][draggable="false"]',  // 头像图片本身
    'header div[role="button"]:first-child',
  ],

  // profile pane 内 "关于" / "About" 行 (clickable · 进入编辑)
  profileAboutRow: [
    'div[aria-label*="About"][role="button"]',
    'div[aria-label*="关于"][role="button"]',
    'span[data-icon="info"]',
    'div[title*="About"]',
    'div[title*="关于"]',
  ],

  // profile pane "关于" 编辑 contenteditable
  profileAboutInput: [
    'div[contenteditable="true"][role="textbox"][title*="About"]',
    'div[contenteditable="true"][aria-label*="About"]',
    'div[contenteditable="true"][aria-label*="关于"]',
    'div[contenteditable="true"][title*="关于"]',
  ],

  // profile pane 关闭/返回按钮
  profilePaneCloseButton: [
    'button[aria-label*="Close"]',
    'button[aria-label*="关闭"]',
    'span[data-icon="x"]',
    'span[data-icon="back"]',
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
