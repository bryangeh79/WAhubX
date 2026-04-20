// M9 · socket.io Gateway (A 决策 · JWT handshake 强制, 匿名 disconnect)
//
// Room 结构:
//   takeover:account:<accountId>   每个接管会话一个房间, 同账号多 tab 共享
//
// 生命周期:
//   1. connect     · handshake.auth.token JWT 校验, 无效立即 disconnect
//   2. subscribe   · client 指定 accountId, 后端 join 房间 + markSocketConnect
//   3. disconnect  · markSocketDisconnect · 10s grace (lock 服务内管 timer)
//
// 推送事件 (server→client):
//   'message.in'          baileys 收到新消息
//   'message.out'         本次 session 或其他 tab 发出的消息 (回显)
//   'lock.acquired'       广播锁获取 (其他 tab 知道)
//   'lock.released'       广播锁释放 (其他 tab 清状态)
//   'lock.hard_kill'      hard-kill 触发
//   'lock.idle_warning'   28 min 预警
//   'lock.idle_timeout'   30 min 自动释放

import { Logger, UnauthorizedException } from '@nestjs/common';
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
import { TakeoverLockService } from './takeover-lock.service';
import { UserSessionService } from '../auth/user-session.service';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import type { RequestUser } from '../auth/decorators/current-user.decorator';
import {
  TAKEOVER_ACQUIRED,
  TAKEOVER_HARD_KILL,
  TAKEOVER_IDLE_TIMEOUT,
  TAKEOVER_IDLE_WARNING,
  TAKEOVER_MESSAGE_IN,
  TAKEOVER_MESSAGE_OUT,
  TAKEOVER_RELEASED,
  type TakeoverAcquiredEvent,
  type TakeoverHardKillEvent,
  type TakeoverIdleEvent,
  type TakeoverMessageEvent,
  type TakeoverReleasedEvent,
} from './takeover.events';

function roomKey(accountId: number): string {
  return `takeover:account:${accountId}`;
}

// 把已认证 user 绑到 socket.data (类型安全访问)
interface AuthedSocket extends Socket {
  data: {
    user: RequestUser;
    subscribedAccountId?: number;
  };
}

@WebSocketGateway({
  namespace: '/takeover',
  cors: {
    origin: true, // 本地桌面 app · 同源多端口 · CORS 宽松 (V1 不跨域部署)
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class TakeoverGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(TakeoverGateway.name);

  constructor(
    private readonly lock: TakeoverLockService,
    private readonly config: ConfigService,
    private readonly sessions: UserSessionService,
    private readonly jwt: JwtService,
  ) {}

  afterInit(): void {
    this.logger.log('TakeoverGateway ready · namespace=/takeover');
  }

  // ── connect · JWT middleware ────────────────────────────
  async handleConnection(client: AuthedSocket): Promise<void> {
    try {
      const token =
        (client.handshake.auth as { token?: string } | undefined)?.token ??
        this.extractFromHeader(client.handshake.headers.authorization);
      if (!token) throw new UnauthorizedException('缺少 token');

      const secret = this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
      const payload = await this.jwt.verifyAsync<JwtPayload>(token, { secret });

      const stillValid = await this.sessions.validateAccessToken(payload.sub, token);
      if (!stillValid) throw new UnauthorizedException('session 已失效');

      const user: RequestUser = {
        id: payload.sub,
        email: payload.email,
        username: payload.username,
        role: payload.role,
        tenantId: payload.tenantId,
        status: 'active',
      };
      client.data = { user };
      this.logger.log(`socket ${client.id} connected as ${user.email} (role=${user.role})`);
    } catch (err) {
      this.logger.warn(
        `socket ${client.id} auth fail: ${err instanceof Error ? err.message : err} · disconnect`,
      );
      client.disconnect(true);
    }
  }

  // ── disconnect ─────────────────────────────────────────
  handleDisconnect(client: AuthedSocket): void {
    const accountId = client.data?.subscribedAccountId;
    if (accountId !== undefined) {
      this.lock.onSocketDisconnect(accountId, client.id);
    }
    this.logger.log(`socket ${client.id} disconnected`);
  }

  // ── subscribe · join room ──────────────────────────────
  @SubscribeMessage('subscribe')
  subscribe(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { accountId: number },
  ): { ok: boolean; room: string } {
    if (!body?.accountId) return { ok: false, room: '' };
    const user = client.data?.user;
    if (!user) {
      client.disconnect(true);
      return { ok: false, room: '' };
    }
    client.data.subscribedAccountId = body.accountId;
    const room = roomKey(body.accountId);
    client.join(room);
    this.lock.onSocketConnect(body.accountId, client.id, user);
    return { ok: true, room };
  }

  @SubscribeMessage('unsubscribe')
  unsubscribe(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { accountId: number },
  ): { ok: boolean } {
    if (!body?.accountId) return { ok: false };
    client.leave(roomKey(body.accountId));
    this.lock.onSocketDisconnect(body.accountId, client.id);
    client.data.subscribedAccountId = undefined;
    return { ok: true };
  }

  // heartbeat 从 client 主动发 (每 10s), 延长 idle timer
  @SubscribeMessage('heartbeat')
  heartbeat(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() body: { accountId: number },
  ): { ok: boolean } {
    if (!body?.accountId) return { ok: false };
    this.lock.heartbeat(body.accountId, client.data.user);
    return { ok: true };
  }

  // ── 事件 fan-out · EventEmitter2 → socket.io rooms ──────
  @OnEvent(TAKEOVER_MESSAGE_IN)
  onMessageIn(ev: TakeoverMessageEvent): void {
    this.server.to(roomKey(ev.accountId)).emit('message.in', ev);
  }

  @OnEvent(TAKEOVER_MESSAGE_OUT)
  onMessageOut(ev: TakeoverMessageEvent): void {
    this.server.to(roomKey(ev.accountId)).emit('message.out', ev);
  }

  @OnEvent(TAKEOVER_ACQUIRED)
  onAcquired(ev: TakeoverAcquiredEvent): void {
    this.server.to(roomKey(ev.accountId)).emit('lock.acquired', ev);
  }

  @OnEvent(TAKEOVER_RELEASED)
  onReleased(ev: TakeoverReleasedEvent): void {
    this.server.to(roomKey(ev.accountId)).emit('lock.released', ev);
  }

  @OnEvent(TAKEOVER_HARD_KILL)
  onHardKill(ev: TakeoverHardKillEvent): void {
    this.server.to(roomKey(ev.accountId)).emit('lock.hard_kill', ev);
  }

  @OnEvent(TAKEOVER_IDLE_WARNING)
  onIdleWarning(ev: TakeoverIdleEvent): void {
    this.server.to(roomKey(ev.accountId)).emit('lock.idle_warning', ev);
  }

  @OnEvent(TAKEOVER_IDLE_TIMEOUT)
  onIdleTimeout(ev: TakeoverIdleEvent): void {
    this.server.to(roomKey(ev.accountId)).emit('lock.idle_timeout', ev);
  }

  private extractFromHeader(auth: string | undefined): string | null {
    if (!auth) return null;
    const [scheme, token] = auth.split(' ');
    return scheme?.toLowerCase() === 'bearer' && token ? token : null;
  }
}
