// 2026-04-25 · D9-2 · ISlotRuntime · slot 级 runtime 抽象 (Codex 边界 2 锁定)
//
// 范围 (锁死 9 方法 · 不许扩):
//   bind 链路:    startBind / cancelBind / getBindStatus
//   状态:         fetchStatus / isOnline
//   消息收发:    sendText / sendMedia
//   事件订阅:    on / off
//
// 不在此接口范围 (Codex 边界):
//   ✗ getStatus / isSlotOnline (老命名 · 不混回)
//   ✗ readMessages / sendReact / sendPresence (留 D10+)
//   ✗ newsletter / group / profile-picture-url (永久不放接口 · 走老 BaileysService 直连)
//   ✗ 恢复策略 / quarantine (留 D11+)

import type {
  RuntimeEvent,
  BindStateEvent,
  ConnectionCloseEvent,
} from './runtime-protocol';

// ═══ 数据类型 ════════════════════════════════════════════════════════

/**
 * D9-2 · bind UI 视图 · 不暴露 runtime 内部细节
 * UI 只看这个 · 不直接读 RuntimeBridgeService 缓存
 */
export interface SlotBindStatus {
  /** runtime 是否在线 (chromium = WS 连接 / baileys = pool 有 socket) */
  online: boolean;
  /** bind session 状态 (跟 BindStateEvent.state 一致 + 'idle') */
  bindState: BindStateEvent['state'] | 'idle';
  /** 最后一张 QR · base64 data URL (qr 状态时有) */
  qrDataUrl: string | null;
  /** QR 已刷新次数 (UI 用来判断 "是不是新 QR") */
  qrRefreshCount: number;
  /** 失败/超时/取消的原因 */
  error: string | null;
  /** start-bind 收到时间 (ms) · idle=0 */
  sessionStartedAt: number;
  /** connected 时间 (ms) · 未到=0 */
  connectedAt: number;
  /** 最后一次 connection-close 详情 (Codex D8-3 区分 4 类) */
  lastDisconnectCategory: ConnectionCloseEvent['category'] | null;
  lastDisconnectReason: string | null;
}

/**
 * D9-2 · runtime 通用状态 · 比 SlotBindStatus 更细 (诊断用)
 * fetchStatus 返这个 · 强制走 runtime 实时拉 · 不走 cache
 */
export interface SlotRuntimeStatus {
  /** runtime fsm 状态 (idle 表示没在跑 bind) */
  bindState: BindStateEvent['state'] | 'idle';
  /** 页面物理状态 (qr/chat-list/splash/closed/etc) · 跟 bindState 解耦 */
  pageState: string;
  /** sessionStartedAt ms */
  sessionStartedAt: number;
}

/**
 * D9-2 · sendMedia 选项 · runtime 实装无关
 */
export interface SendMediaOptions {
  caption?: string;
  /** voice 用 · true = ptt 语音 · false/undefined = 普通 audio */
  ptt?: boolean;
  /** file 用 · WA document 必需 */
  fileName?: string;
}

/**
 * D9-2 · sendText/sendMedia 返回
 */
export interface SendResult {
  /** WA messageId · 失败时 null */
  messageId: string | null;
}

/**
 * D9-2 · runtime 事件 handler 签名
 */
export type RuntimeEventHandler = (evt: RuntimeEvent) => void;

// ═══ 接口本体 ════════════════════════════════════════════════════════

/**
 * ISlotRuntime · slot 级 runtime 抽象
 *
 * 实装:
 *   - BaileysSlotRuntime · 老路径包 BaileysService (D9-3)
 *   - ChromiumSlotRuntime · 走 RuntimeBridgeService (D9-3)
 *
 * 选择: SlotRuntimeRegistry 按 RUNTIME_MODE env 路由 (D9-4)
 */
export interface ISlotRuntime {
  // ─── bind 链路 ────────────────────────────────────
  /**
   * 开始扫码绑号 · 异步触发 · 通过 'bind-state' 事件回报进展
   * @param slotId
   * @param pairingPhoneNumber 给 = pair code 模式 · 不给 = QR 模式
   * @returns 立即返 starting 状态 · 不阻塞等流程
   */
  startBind(slotId: number, pairingPhoneNumber?: string): Promise<{ state: string }>;

  /**
   * 取消进行中的 bind 流程
   */
  cancelBind(slotId: number): Promise<{ wasInState: string }>;

  /**
   * 拉当前 bind UI 状态 · 默认走 backend 缓存 · 不打 runtime
   */
  getBindStatus(slotId: number): SlotBindStatus | Promise<SlotBindStatus>;

  // ─── 状态 ────────────────────────────────────────
  /**
   * 强制拉 runtime 实时状态 · 跟 cache 比对用 · 诊断
   */
  fetchStatus(slotId: number): Promise<SlotRuntimeStatus>;

  /**
   * runtime 是否在线 · sync · 用于派任务前检查
   */
  isOnline(slotId: number): boolean;

  // ─── 消息收发 ────────────────────────────────────
  /**
   * 发文本 · D9 chromium 实现可 stub (W2 D10 实装真 DOM 自动化)
   */
  sendText(slotId: number, to: string, text: string): Promise<SendResult>;

  /**
   * 发媒体 · D9 chromium 实现可 stub (W2 D10 实装)
   * @param mediaType 'image' | 'video' | 'voice' | 'audio' | 'file'
   */
  sendMedia(
    slotId: number,
    to: string,
    mediaType: 'image' | 'video' | 'voice' | 'audio' | 'file',
    mediaBase64: string,
    options?: SendMediaOptions,
  ): Promise<SendResult>;

  // ─── 2026-04-26 · D11 · WA Status / Profile ────────
  /**
   * 发文字 status · chromium 用 wa-web · baileys 用 sendStatusText
   */
  postStatusText?(slotId: number, text: string, bgColor?: string): Promise<SendResult>;

  /**
   * 发图/视频 status · chromium 用 wa-web · baileys 用 sendStatusMedia
   */
  postStatusMedia?(
    slotId: number,
    mediaType: 'image' | 'video',
    mediaBase64: string,
    options?: { caption?: string; fileName?: string },
  ): Promise<SendResult>;

  /**
   * 浏览未读他人 status · 模拟看动态 · 留 view 痕给作者
   */
  browseStatuses?(
    slotId: number,
    options: { maxItems: number; dwellMs: number },
  ): Promise<{ viewed: number }>;

  /**
   * 给最前 N 条 status 点赞 · 防风控硬上限 5
   */
  reactStatuses?(
    slotId: number,
    options: { maxItems: number; emoji: string },
  ): Promise<{ reacted: number }>;

  /**
   * 改个人"关于"/签名
   */
  updateProfileAbout?(slotId: number, text: string): Promise<void>;

  // ─── 事件订阅 ────────────────────────────────────
  /**
   * 订阅 runtime 事件 · 全部 RuntimeEvent 类型 · 业务模块按 type 自筛
   */
  on(event: RuntimeEvent['type'] | '*', handler: RuntimeEventHandler): void;

  /**
   * 取消订阅
   */
  off(event: RuntimeEvent['type'] | '*', handler: RuntimeEventHandler): void;
}
