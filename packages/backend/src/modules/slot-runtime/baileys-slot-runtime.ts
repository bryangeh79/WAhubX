// 2026-04-25 · D9-3 · BaileysSlotRuntime · 老路径包 BaileysService (Codex 边界 3)
//
// 适配层 · 不准在这一步给 Baileys 加新功能 · 只负责把 BaileysService 的方法对到 ISlotRuntime
//
// 当前 backend 主路径仍走 baileys (RUNTIME_MODE=baileys 默认) · 这个适配层证明
// "老路径" 也能走 ISlotRuntime · 业务模块迁移过程中两边形态一致.

import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import type {
  ISlotRuntime,
  SlotBindStatus,
  SlotRuntimeStatus,
  SendMediaOptions,
  SendResult,
  RuntimeEventHandler,
} from '@wahubx/shared';
import { BaileysService } from '../baileys/baileys.service';

@Injectable()
export class BaileysSlotRuntime implements ISlotRuntime {
  private readonly logger = new Logger(BaileysSlotRuntime.name);
  // 内部 EventEmitter · 把 baileys EventEmitter2 的事件转成 RuntimeEvent 形态
  // D9-3 stub: baileys 老路径事件命名空间不同 · 暂不转 · D11+ 慢慢迁
  private readonly handlers = new Map<string, Set<RuntimeEventHandler>>();

  constructor(
    @Inject(forwardRef(() => BaileysService))
    private readonly baileys: BaileysService,
  ) {}

  // ─── bind 链路 ───────────────────────────────────
  async startBind(slotId: number, pairingPhoneNumber?: string): Promise<{ state: string }> {
    const view = await this.baileys.startBind(slotId, pairingPhoneNumber);
    return { state: view.state };
  }

  async cancelBind(slotId: number): Promise<{ wasInState: string }> {
    const view = await this.baileys.cancelBind(slotId);
    return { wasInState: view.state };
  }

  getBindStatus(slotId: number): SlotBindStatus {
    const view = this.baileys.getStatus(slotId);
    // BaileysService.BindStatusView 有 state/qr/error/startedAt/lastEventAt
    // 投影到 ISlotRuntime.SlotBindStatus
    return {
      online: this.baileys.isInPool(slotId),
      bindState: view.state as SlotBindStatus['bindState'],
      qrDataUrl: view.qr ?? null,
      qrRefreshCount: 0, // baileys 老路径不记 refreshCount
      error: view.error ?? null,
      sessionStartedAt: view.startedAt ? new Date(view.startedAt).getTime() : 0,
      connectedAt: 0, // baileys 路径不区分 (跟 connected 等价)
      lastDisconnectCategory: null,
      lastDisconnectReason: null,
    };
  }

  // ─── 状态 ────────────────────────────────────────
  async fetchStatus(slotId: number): Promise<SlotRuntimeStatus> {
    const view = this.baileys.getStatus(slotId);
    return {
      bindState: view.state as SlotRuntimeStatus['bindState'],
      pageState: 'unknown', // baileys 没"页面"概念
      sessionStartedAt: view.startedAt ? new Date(view.startedAt).getTime() : 0,
    };
  }

  isOnline(slotId: number): boolean {
    return this.baileys.isInPool(slotId);
  }

  // ─── 消息收发 (老路径完全实装) ───────────────────────
  async sendText(slotId: number, to: string, text: string): Promise<SendResult> {
    const r = await this.baileys.sendText(slotId, to, text);
    return { messageId: r.waMessageId ?? null };
  }

  async sendMedia(
    slotId: number,
    to: string,
    mediaType: 'image' | 'video' | 'voice' | 'audio' | 'file',
    mediaBase64: string,
    options?: SendMediaOptions,
  ): Promise<SendResult> {
    // BaileysService.sendMedia 形态不同 · type 用 'image'|'video'|'voice'
    // baileys 暂不支持 file/audio · D9-3 不强求一致 · 抛 not-supported
    if (mediaType === 'audio' || mediaType === 'file') {
      this.logger.warn(`baileys runtime: mediaType=${mediaType} 暂不支持 (老路径 limitation)`);
      return { messageId: null };
    }
    // BaileysService.sendMedia signature 不接 ptt · D9-3 简化 · 不传
    const r = await this.baileys.sendMedia(slotId, to, mediaType, mediaBase64, {
      caption: options?.caption,
    });
    return { messageId: r.waMessageId ?? null };
  }

  // ─── 事件订阅 (D9-3 简化实装) ──────────────────────
  // 老路径事件命名空间是 'baileys.worker.<type>' · 跟 RuntimeEvent.type 不一一对
  // D9-3 范围只让接口存在 · 真转发留 D11+
  on(event: string, handler: RuntimeEventHandler): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    this.logger.debug?.(`baileys runtime: subscribe ${event} (passthrough not yet wired)`);
  }

  off(event: string, handler: RuntimeEventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }
}
