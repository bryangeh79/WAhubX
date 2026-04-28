// 2026-04-26 · P0.10++ · CDP screencast frame forward gateway
// Runtime → backend (WS bridge) → 这个 gateway → 5173 socket.io
//
// Room: 'screencast:slot:<slotId>'
// Events:
//   client → server:
//     'subscribe' { slotId }      订阅 + 触发 backend 给 runtime 发 start-screencast cmd
//     'unsubscribe' { slotId }    退订 + 房间空了停 screencast
//     'input' { slotId, event }   反向输入事件 · forward 到 runtime
//   server → client:
//     'frame' { slotId, data, mime, w, h }
//     'error' { slotId, error }
//
// JWT auth: handshake.auth.token (跟 takeover.gateway 同款)

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { RuntimeBridgeService } from './runtime-bridge.service';

interface JwtUser {
  sub: string;
  tenantId: number | null;
  role: string;
}

@WebSocketGateway({
  namespace: '/screencast',
  cors: { origin: true, credentials: true },
})
export class ScreencastGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(ScreencastGateway.name);
  @WebSocketServer() server!: Server;
  // slotId → user-set { sockets, screencastActive }
  private readonly slotSubscribers = new Map<number, Set<string>>(); // socketId

  constructor(
    private readonly bridge: RuntimeBridgeService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  afterInit(): void {
    this.logger.log('P0.10++ ScreencastGateway · /screencast namespace ready');
  }

  async handleConnection(client: Socket): Promise<void> {
    const token = (client.handshake.auth?.token as string | undefined) || '';
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const payload = await this.jwt.verifyAsync<JwtUser>(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET') ?? 'dev-access-secret',
      });
      (client.data as { user: JwtUser }).user = payload;
      this.logger.log(`screencast client connected · sock=${client.id} tenant=${payload.tenantId}`);
    } catch (err) {
      this.logger.warn(`screencast handshake JWT 失败 · ${err instanceof Error ? err.message : err}`);
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    // 清 subscriptions
    for (const [slotId, sockets] of this.slotSubscribers.entries()) {
      if (sockets.delete(client.id)) {
        if (sockets.size === 0) {
          this.slotSubscribers.delete(slotId);
          // 自动停 screencast (没人看了)
          void this.stopScreencastForSlot(slotId);
        }
      }
    }
    this.logger.log(`screencast client disconnected · sock=${client.id}`);
  }

  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @MessageBody() body: { slotId: number },
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: boolean; error?: string }> {
    const slotId = Number(body?.slotId);
    if (!slotId) return { ok: false, error: 'slotId required' };
    if (!this.bridge.hasConnection(slotId)) {
      return { ok: false, error: `slot ${slotId} runtime offline · 请先扫码绑定` };
    }
    let sockets = this.slotSubscribers.get(slotId);
    if (!sockets) {
      sockets = new Set<string>();
      this.slotSubscribers.set(slotId, sockets);
    }
    sockets.add(client.id);
    void client.join(`screencast:slot:${slotId}`);

    // 第一次订阅 · 给 runtime 发 start-screencast cmd
    if (sockets.size === 1) {
      try {
        await this.bridge.sendCommand(slotId, {
          kind: 'cmd',
          type: 'start-screencast',
          fps: 5,
          quality: 60,
        } as Parameters<RuntimeBridgeService['sendCommand']>[1]);
        this.logger.log(`P0.10++ slot ${slotId} screencast 启动 · 1 个订阅`);
      } catch (err) {
        sockets.delete(client.id);
        if ((sockets.size as number) === 0) this.slotSubscribers.delete(slotId);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    return { ok: true };
  }

  @SubscribeMessage('unsubscribe')
  async handleUnsubscribe(
    @MessageBody() body: { slotId: number },
    @ConnectedSocket() client: Socket,
  ): Promise<{ ok: boolean }> {
    const slotId = Number(body?.slotId);
    const sockets = this.slotSubscribers.get(slotId);
    if (sockets) {
      sockets.delete(client.id);
      void client.leave(`screencast:slot:${slotId}`);
      if (sockets.size === 0) {
        this.slotSubscribers.delete(slotId);
        await this.stopScreencastForSlot(slotId);
      }
    }
    return { ok: true };
  }

  @SubscribeMessage('input')
  async handleInput(
    @MessageBody() body: { slotId: number; event: unknown },
    @ConnectedSocket() _client: Socket,
  ): Promise<{ ok: boolean; error?: string }> {
    const slotId = Number(body?.slotId);
    if (!slotId || !body?.event) return { ok: false, error: 'slotId + event required' };
    if (!this.bridge.hasConnection(slotId)) return { ok: false, error: 'runtime offline' };
    try {
      await this.bridge.sendCommand(slotId, {
        kind: 'cmd',
        type: 'screencast-input',
        event: body.event,
      } as Parameters<RuntimeBridgeService['sendCommand']>[1]);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async stopScreencastForSlot(slotId: number): Promise<void> {
    if (!this.bridge.hasConnection(slotId)) return;
    try {
      await this.bridge.sendCommand(slotId, {
        kind: 'cmd',
        type: 'stop-screencast',
      } as Parameters<RuntimeBridgeService['sendCommand']>[1]);
      this.logger.log(`P0.10++ slot ${slotId} screencast 停止 (无订阅者)`);
    } catch (err) {
      this.logger.debug?.(`stop-screencast 失败: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ═══ EventEmitter2 监听 · runtime 推 frame · forward 到 socket.io room ═══
  @OnEvent('runtime.bridge.screencast-frame')
  handleFrameEvent(evt: {
    slotId: number;
    ts: number;
    data: string;
    mime: string;
    width: number;
    height: number;
    sessionId: number;
  }): void {
    if (!this.server) return;
    const subscribers = this.slotSubscribers.get(evt.slotId);
    if (!subscribers || subscribers.size === 0) return;
    this.server.to(`screencast:slot:${evt.slotId}`).emit('frame', {
      slotId: evt.slotId,
      ts: evt.ts,
      data: evt.data,
      mime: evt.mime,
      width: evt.width,
      height: evt.height,
    });
  }
}
