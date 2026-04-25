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
} from '@wahubx/shared';
import { eventName } from '@wahubx/shared';
import { RuntimeBridgeService } from '../runtime-bridge/runtime-bridge.service';

@Injectable()
export class ChromiumSlotRuntime implements ISlotRuntime {
  private readonly logger = new Logger(ChromiumSlotRuntime.name);
  // event handlers · 内部转发 EventEmitter2 的 'runtime.bridge.*' 给业务订阅者
  private readonly handlers = new Map<string, Set<RuntimeEventHandler>>();
  private subscribed = false;

  constructor(
    private readonly bridge: RuntimeBridgeService,
    private readonly globalEvents: EventEmitter2,
  ) {}

  // ─── bind 链路 ───────────────────────────────────
  async startBind(slotId: number, pairingPhoneNumber?: string): Promise<{ state: string }> {
    return this.bridge.startBind(slotId, pairingPhoneNumber);
  }

  async cancelBind(slotId: number): Promise<{ wasInState: string }> {
    return this.bridge.cancelBind(slotId);
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

  // ─── 消息收发 · D9-3 stub · D10 W2 真实装 ───────────
  async sendText(_slotId: number, _to: string, _text: string): Promise<SendResult> {
    // D10 W2: this.bridge.sendCommand(slotId, { kind:'cmd', type:'send-text', to, text })
    //         然后 runtime 走 WA Web DOM 自动化点击/输入/发送
    throw new Error('chromium runtime: sendText not implemented yet (W2 D10)');
  }

  async sendMedia(
    _slotId: number,
    _to: string,
    _mediaType: 'image' | 'video' | 'voice' | 'audio' | 'file',
    _mediaBase64: string,
    _options?: SendMediaOptions,
  ): Promise<SendResult> {
    // D10 W2: 走 input[type=file] 上传路径 (Codex 锁: paste 留后续 · 优先 file input)
    throw new Error('chromium runtime: sendMedia not implemented yet (W2 D10)');
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
