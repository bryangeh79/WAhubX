// 2026-04-25 · D9-3 · ChromiumSlotRuntime · 走 RuntimeBridgeService (Codex 边界 4)
//
// 接口对齐 · sendText/sendMedia 暂 stub (Codex: 类型签名定好 · 不偷跑 W2 DOM 自动化)
// W2 D10 真实装 sendText/sendMedia · 这里 throw not-implemented 即可

import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  ISlotRuntime,
  SlotBindStatus,
  SlotRuntimeStatus,
  SendMediaOptions,
  SendResult,
  RuntimeEvent,
  RuntimeEventHandler,
  RuntimeCommand,
} from '@wahubx/shared';
import { eventName } from '@wahubx/shared';
import { RuntimeBridgeService } from '../runtime-bridge/runtime-bridge.service';
import { RuntimeProcessManagerService } from '../runtime-process/runtime-process-manager.service';

@Injectable()
export class ChromiumSlotRuntime implements ISlotRuntime {
  private readonly logger = new Logger(ChromiumSlotRuntime.name);
  // event handlers · 内部转发 EventEmitter2 的 'runtime.bridge.*' 给业务订阅者
  private readonly handlers = new Map<string, Set<RuntimeEventHandler>>();
  private subscribed = false;

  constructor(
    private readonly bridge: RuntimeBridgeService,
    private readonly globalEvents: EventEmitter2,
    private readonly processManager: RuntimeProcessManagerService,
  ) {}

  /**
   * 2026-04-25 · lazy-start · 没 runtime 进程时自动 spawn + 等连上 WS 桥
   * 解决: frontend 5173 点"绑定" · 但 runtime 进程没跑 · sendCommand 必失败的问题
   * 超时 30s · 仍没连上抛
   */
  private async ensureRuntimeOnline(slotId: number, timeoutMs = 30_000): Promise<void> {
    // 2026-04-25 · P0.1 集中补洞 · race fix: 仅"WS 已连"不够 · runtime D8-1 阶段先开 WS · ~850ms 后才注册 D8-2 cmd handler
    //   早期发的 start-bind 落 D8-1 noop ack · runBindFlow 永不跑 · 表现: g_state 永远 'connecting' · sendText 必死
    //   修法: 持续 init cmd 探测 · 直到响应含 initialized:true (D8-2 handler 标志)
    const startedAt = Date.now();

    if (!this.bridge.hasConnection(slotId)) {
      this.logger.log(`slot ${slotId} runtime 未在线 · lazy-start spawn`);
      const procState = await this.processManager.start(slotId);
      if (procState.status === 'failed') {
        throw new Error(
          `slot ${slotId} runtime spawn 失败 · class=${procState.exitClass} · ${procState.lastError ?? ''}`,
        );
      }
      // 等 WS 桥连上 · poll 500ms
      while (Date.now() - startedAt < timeoutMs) {
        if (this.bridge.hasConnection(slotId)) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      if (!this.bridge.hasConnection(slotId)) {
        throw new Error(`slot ${slotId} runtime spawned but WS bridge 未连上 · 超时 ${timeoutMs}ms`);
      }
    }

    // 2026-04-25 · P0.1 race fix · 持续 init 探测 · 直到 D8-2 handler 注册
    //   D8-1 noop ack 形态: { ok:true, data: undefined / 不带 initialized 字段 }
    //   D8-2 init 实装形态: { ok:true, data: { initialized: true, slotId } }
    while (Date.now() - startedAt < timeoutMs) {
      try {
        const r = await this.bridge.sendCommand<{ initialized?: boolean }>(slotId, {
          kind: 'cmd',
          type: 'init',
        } as Omit<RuntimeCommand, 'requestId'>);
        if (r && r.initialized === true) {
          this.logger.log(
            `slot ${slotId} runtime D8-2 handler ready · 耗时 ${Date.now() - startedAt}ms`,
          );
          return;
        }
      } catch {
        /* init 失败 (handler 还没注册时正常) · 重试 */
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(
      `slot ${slotId} runtime D8-2 handler 未注册 · 超时 ${timeoutMs}ms · spawn 可能 hang 在 startup-checks`,
    );
  }

  // ─── bind 链路 ───────────────────────────────────
  async startBind(slotId: number, pairingPhoneNumber?: string): Promise<{ state: string }> {
    await this.ensureRuntimeOnline(slotId);
    return this.bridge.startBind(slotId, pairingPhoneNumber);
  }

  async cancelBind(slotId: number): Promise<{ wasInState: string }> {
    // 2026-04-25 · P0.3 · "no bind in progress" 不是异常 · 是合法业务态
    // bridge.cancelBind() 内部 sendCommand · ack ok=false → throw · 这里 catch 回归正常返
    try {
      return await this.bridge.cancelBind(slotId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/no bind in progress|not.*progress/i.test(msg)) {
        // bind 已完成 / idle / 没启 · 视作幂等 cancel
        this.logger.log(`slot ${slotId} cancel-bind 幂等 (无在跑 bind): ${msg}`);
        return { wasInState: 'idle' };
      }
      // bridge 不在线 (runtime 没起): 也视作 cancel 无意义 · 回正常返
      if (/runtime not connected/i.test(msg)) {
        this.logger.log(`slot ${slotId} cancel-bind · runtime 未连 · 视作 idle`);
        return { wasInState: 'idle' };
      }
      throw err;
    }
  }

  getBindStatus(slotId: number): SlotBindStatus {
    const cache = this.bridge.getCachedBindState(slotId);
    if (!cache) {
      return {
        online: this.bridge.hasConnection(slotId),
        bindState: 'idle',
        qrDataUrl: null,
        qrRefreshCount: 0,
        error: null,
        sessionStartedAt: 0,
        connectedAt: 0,
        lastDisconnectCategory: null,
        lastDisconnectReason: null,
      };
    }
    return {
      online: this.bridge.hasConnection(slotId),
      bindState: cache.bindState as SlotBindStatus['bindState'],
      qrDataUrl: cache.qrDataUrl,
      qrRefreshCount: cache.qrRefreshCount,
      error: cache.error,
      sessionStartedAt: cache.sessionStartedAt,
      connectedAt: cache.connectedAt,
      lastDisconnectCategory: cache.lastDisconnectCategory as SlotBindStatus['lastDisconnectCategory'],
      lastDisconnectReason: cache.lastDisconnectReason,
    };
  }

  // ─── 状态 ────────────────────────────────────────
  async fetchStatus(slotId: number): Promise<SlotRuntimeStatus> {
    const result = await this.bridge.fetchStatus(slotId);
    return {
      bindState: result.state as SlotRuntimeStatus['bindState'],
      pageState: result.pageState,
      sessionStartedAt: result.sessionStartedAt,
    };
  }

  isOnline(slotId: number): boolean {
    return this.bridge.hasConnection(slotId);
  }

  // ─── 消息收发 · D10 W2 真实装 ─────────────────────
  async sendText(slotId: number, to: string, text: string): Promise<SendResult> {
    const cmd = {
      kind: 'cmd',
      type: 'send-text',
      to,
      text,
    } as unknown as Omit<RuntimeCommand, 'requestId'>;
    const r = await this.bridge.sendCommand<{ messageId: string | null }>(slotId, cmd);
    return { messageId: r?.messageId ?? null };
  }

  async sendMedia(
    slotId: number,
    to: string,
    mediaType: 'image' | 'video' | 'voice' | 'audio' | 'file',
    mediaBase64: string,
    options?: SendMediaOptions,
  ): Promise<SendResult> {
    // 2026-04-28 · B1+B2 · video/voice/audio 全开 · runtime 内分流到 image/file 上传通道
    //   待用户真机验证 (MORNING_TODO 列出)
    const cmd = {
      kind: 'cmd',
      type: 'send-media',
      to,
      mediaType,
      mediaBase64,
      caption: options?.caption,
      fileName: options?.fileName,
    } as unknown as Omit<RuntimeCommand, 'requestId'>;
    const r = await this.bridge.sendCommand<{ messageId: string | null }>(slotId, cmd);
    return { messageId: r?.messageId ?? null };
  }

  // ─── 2026-04-26 · D11 · WA Status / Profile · 走 wa-web cmd ──────
  async postStatusText(slotId: number, text: string, bgColor?: string): Promise<SendResult> {
    const cmd = {
      kind: 'cmd',
      type: 'post-status-text',
      text,
      bgColor,
    } as unknown as Omit<RuntimeCommand, 'requestId'>;
    const r = await this.bridge.sendCommand<{ messageId: string | null }>(slotId, cmd);
    return { messageId: r?.messageId ?? null };
  }

  async postStatusMedia(
    slotId: number,
    mediaType: 'image' | 'video',
    mediaBase64: string,
    options?: { caption?: string; fileName?: string },
  ): Promise<SendResult> {
    const cmd = {
      kind: 'cmd',
      type: 'post-status-media',
      mediaType,
      mediaBase64,
      caption: options?.caption,
      fileName: options?.fileName,
    } as unknown as Omit<RuntimeCommand, 'requestId'>;
    const r = await this.bridge.sendCommand<{ messageId: string | null }>(slotId, cmd);
    return { messageId: r?.messageId ?? null };
  }

  async browseStatuses(
    slotId: number,
    options: { maxItems: number; dwellMs: number },
  ): Promise<{ viewed: number }> {
    const cmd = {
      kind: 'cmd',
      type: 'browse-statuses',
      maxItems: options.maxItems,
      dwellMs: options.dwellMs,
    } as unknown as Omit<RuntimeCommand, 'requestId'>;
    const r = await this.bridge.sendCommand<{ viewed: number }>(slotId, cmd);
    return { viewed: r?.viewed ?? 0 };
  }

  async reactStatuses(
    slotId: number,
    options: { maxItems: number; emoji: string },
  ): Promise<{ reacted: number }> {
    const cmd = {
      kind: 'cmd',
      type: 'react-status',
      maxItems: options.maxItems,
      emoji: options.emoji,
    } as unknown as Omit<RuntimeCommand, 'requestId'>;
    const r = await this.bridge.sendCommand<{ reacted: number }>(slotId, cmd);
    return { reacted: r?.reacted ?? 0 };
  }

  async updateProfileAbout(slotId: number, text: string): Promise<void> {
    const cmd = {
      kind: 'cmd',
      type: 'update-profile-about',
      text,
    } as unknown as Omit<RuntimeCommand, 'requestId'>;
    await this.bridge.sendCommand<undefined>(slotId, cmd);
  }

  // ─── 事件订阅 ────────────────────────────────────
  on(event: RuntimeEvent['type'] | '*', handler: RuntimeEventHandler): void {
    this.subscribeOnce();
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  off(event: RuntimeEvent['type'] | '*', handler: RuntimeEventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  /**
   * 第一次有人订阅时 · 把 EventEmitter2 的全部 'runtime.bridge.*' 转发给本地 handler
   */
  private subscribeOnce(): void {
    if (this.subscribed) return;
    this.subscribed = true;

    // 用 wildcard listener · 接所有 runtime.bridge.* event
    this.globalEvents.onAny((rawEvent, payload) => {
      const eventStr = String(rawEvent);
      if (!eventStr.startsWith(eventName('').replace(/\.$/, ''))) return;
      // 'runtime.bridge.qr' → 'qr'
      const subType = eventStr.split('.').slice(2).join('.');
      const evt = payload as RuntimeEvent;
      // 派发给具体 type
      this.handlers.get(subType as RuntimeEvent['type'])?.forEach((h) => {
        try {
          h(evt);
        } catch (err) {
          this.logger.warn(`event handler threw: ${err instanceof Error ? err.message : err}`);
        }
      });
      // 派发给 wildcard
      this.handlers.get('*')?.forEach((h) => {
        try {
          h(evt);
        } catch (err) {
          this.logger.warn(`event handler (*) threw: ${err instanceof Error ? err.message : err}`);
        }
      });
    });
  }
}
