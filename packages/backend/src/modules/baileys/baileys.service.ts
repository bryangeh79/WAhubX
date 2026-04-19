// M2 Week 1: 扫码绑定现有号 (takeover 模式)
// 不做: 新号注册 (M2 W3), 发/收消息业务逻辑 (M2 W2), 队列并发仲裁 (M3)
//
// 职责:
//   1. 管理 slot 级 Baileys socket (每槽位独立 socket + 独立 auth state 目录)
//   2. 捕获 connection.update.qr → 存内存供前端轮询
//   3. connection.update.connection=open → 写 wa_account / 绑定 slot / close socket (takeover 模式默认不常驻; M2 W2 再做 online 常驻)
//   4. 取消 / 超时 / 断线自清理
import { Injectable, Logger, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Boom } from '@hapi/boom';
import { DataSource } from 'typeorm';
import {
  type WASocket,
  DisconnectReason,
  default as makeWASocket,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { AccountSlotEntity, AccountSlotStatus } from '../slots/account-slot.entity';
import { WaAccountEntity } from '../slots/wa-account.entity';
import { AccountHealthEntity, RiskLevel } from '../slots/account-health.entity';
import { getWaSessionDir } from '../../common/storage';

export type BindState = 'idle' | 'starting' | 'qr' | 'connecting' | 'connected' | 'failed' | 'cancelled' | 'timeout';

export interface BindStatusView {
  state: BindState;
  qr: string | null;          // Baileys 生成的 raw 字符串, 前端用 qrcode lib 渲成图
  phoneNumber: string | null; // connection=open 后填
  startedAt: string;
  lastEventAt: string;
  error: string | null;
}

interface BindContext {
  slotId: number;
  slotIndex: number;
  tenantId: number;
  sock: WASocket | null;
  status: BindStatusView;
  timeoutHandle: NodeJS.Timeout | null;
}

const BIND_TIMEOUT_MS = 2 * 60 * 1000; // 2 分钟没扫 = 超时

@Injectable()
export class BaileysService implements OnModuleDestroy {
  private readonly logger = new Logger(BaileysService.name);
  private readonly contexts = new Map<number, BindContext>();
  // Baileys 要一个 pino logger 实例; 用 silent 避免 noise, 错误走自己的 Nest Logger
  private readonly baileysLogger = pino({ level: 'silent' });

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async onModuleDestroy() {
    // 优雅关闭: 结束所有进行中 session
    for (const ctx of this.contexts.values()) {
      await this.teardown(ctx, 'cancelled', 'shutdown');
    }
    this.contexts.clear();
  }

  getStatus(slotId: number): BindStatusView {
    const ctx = this.contexts.get(slotId);
    if (!ctx) {
      return {
        state: 'idle',
        qr: null,
        phoneNumber: null,
        startedAt: new Date().toISOString(),
        lastEventAt: new Date().toISOString(),
        error: null,
      };
    }
    return { ...ctx.status };
  }

  async startBind(slotId: number): Promise<BindStatusView> {
    const slot = await this.dataSource.getRepository(AccountSlotEntity).findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException(`槽位 ${slotId} 不存在`);
    if (slot.status !== AccountSlotStatus.Empty) {
      throw new Error(`槽位 ${slotId} 当前状态 ${slot.status}, 只有 empty 槽位可绑定新号`);
    }

    // 已有进行中 session → 直接返回状态 (幂等)
    const existing = this.contexts.get(slotId);
    if (existing && ['qr', 'connecting', 'starting'].includes(existing.status.state)) {
      return { ...existing.status };
    }
    if (existing) await this.teardown(existing, 'cancelled', 'restarted');

    const ctx: BindContext = {
      slotId,
      slotIndex: slot.slotIndex,
      tenantId: slot.tenantId,
      sock: null,
      status: {
        state: 'starting',
        qr: null,
        phoneNumber: null,
        startedAt: new Date().toISOString(),
        lastEventAt: new Date().toISOString(),
        error: null,
      },
      timeoutHandle: null,
    };
    this.contexts.set(slotId, ctx);

    // 异步启动 socket, 不阻塞 controller 响应
    void this.spawnSocket(ctx).catch((err) => {
      this.logger.error(`slot ${slotId} spawn failed: ${err}`);
      ctx.status.state = 'failed';
      ctx.status.error = err instanceof Error ? err.message : String(err);
      ctx.status.lastEventAt = new Date().toISOString();
    });

    ctx.timeoutHandle = setTimeout(() => {
      void this.teardown(ctx, 'timeout', '2 分钟内未完成扫码');
    }, BIND_TIMEOUT_MS);

    return { ...ctx.status };
  }

  async cancelBind(slotId: number): Promise<BindStatusView> {
    const ctx = this.contexts.get(slotId);
    if (!ctx) {
      return this.getStatus(slotId);
    }
    await this.teardown(ctx, 'cancelled', 'user cancelled');
    return { ...ctx.status };
  }

  // ── 内部 ──────────────────────────────────────────────
  private async spawnSocket(ctx: BindContext): Promise<void> {
    const sessionDir = getWaSessionDir(ctx.slotIndex);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    // Baileys 6.7.x 硬编码的 WA web 客户端版本会过期导致 405 (服务器拒绝).
    // fetchLatestBaileysVersion 从 baileys 官方源拉最新可用版本.
    // 离线部署场景 (生产) 这里会 fail, M10 加离线 fallback 版本缓存.
    const { version, isLatest } = await fetchLatestBaileysVersion();
    this.logger.log(`Baileys WA version ${version.join('.')} (isLatest=${isLatest})`);

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: this.baileysLogger,
      browser: ['WAhubX', 'Desktop', '1.0.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });
    ctx.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, qr, lastDisconnect } = update;
      ctx.status.lastEventAt = new Date().toISOString();

      if (qr) {
        ctx.status.state = 'qr';
        ctx.status.qr = qr;
        this.logger.log(`slot ${ctx.slotId} QR refreshed`);
      }

      if (connection === 'connecting') {
        ctx.status.state = 'connecting';
      }

      if (connection === 'open') {
        void this.onConnectionOpen(ctx);
      }

      if (connection === 'close') {
        const code =
          lastDisconnect?.error instanceof Boom
            ? (lastDisconnect.error as Boom).output.statusCode
            : 0;
        // 登出 / 受限 / 替换 → 失败; 其他可能是短暂断线, M2 W1 统一当失败处理简化逻辑
        if (ctx.status.state !== 'connected') {
          const reason = Object.entries(DisconnectReason).find(([, v]) => v === code)?.[0] ?? 'unknown';
          this.logger.warn(`slot ${ctx.slotId} connection closed before pairing: ${reason} (${code})`);
          void this.teardown(ctx, 'failed', `连接关闭 (${reason})`);
        }
      }
    });
  }

  private async onConnectionOpen(ctx: BindContext): Promise<void> {
    try {
      const sock = ctx.sock;
      if (!sock?.user?.id) {
        throw new Error('socket.user.id 缺失, 无法获取手机号');
      }

      // sock.user.id 形如 "60123456789:11@s.whatsapp.net"; 取冒号前作为 phone
      const phone = sock.user.id.split(':')[0].split('@')[0];
      const sessionPath = getWaSessionDir(ctx.slotIndex);

      await this.dataSource.transaction(async (manager) => {
        const slot = await manager.findOne(AccountSlotEntity, { where: { id: ctx.slotId } });
        if (!slot) throw new Error(`slot ${ctx.slotId} 不存在 (race with clear?)`);

        // 同一手机号若已在其他槽位注册, 反对重复绑定
        const existing = await manager.findOne(WaAccountEntity, { where: { phoneNumber: phone } });
        if (existing) {
          throw new Error(`手机号 ${phone} 已在其他槽位注册 (account_id=${existing.id})`);
        }

        const waAccount = manager.create(WaAccountEntity, {
          phoneNumber: phone,
          countryCode: phone.startsWith('60') ? 'MY' : phone.slice(0, 2),
          sessionPath,
          registeredAt: new Date(),
          lastOnlineAt: new Date(),
          waNickname: sock.user?.name ?? null,
        });
        const savedAccount = await manager.save(waAccount);

        await manager.save(manager.create(AccountHealthEntity, {
          accountId: savedAccount.id,
          healthScore: 100,
          riskLevel: RiskLevel.Low,
          riskFlags: [],
          totalSent: 0,
          totalReceived: 0,
        }));

        slot.accountId = savedAccount.id;
        slot.status = AccountSlotStatus.Warmup; // 扫码进来直接进养号 (M5 养号日历接入)
        slot.profilePath = sessionPath;
        await manager.save(slot);
      });

      ctx.status.state = 'connected';
      ctx.status.phoneNumber = phone;
      ctx.status.lastEventAt = new Date().toISOString();
      this.logger.log(`slot ${ctx.slotId} bound phone ${phone}`);

      // M2 W1 takeover 只做绑定, 不维持长连接. 关 socket 让 creds 落盘即可.
      await this.teardown(ctx, 'connected', null);
    } catch (err) {
      this.logger.error(`slot ${ctx.slotId} onConnectionOpen failed: ${err}`);
      ctx.status.state = 'failed';
      ctx.status.error = err instanceof Error ? err.message : String(err);
      await this.teardown(ctx, 'failed', ctx.status.error);
    }
  }

  private async teardown(ctx: BindContext, finalState: BindState, errorMsg: string | null): Promise<void> {
    if (ctx.timeoutHandle) {
      clearTimeout(ctx.timeoutHandle);
      ctx.timeoutHandle = null;
    }
    if (ctx.sock) {
      try {
        // logout 会让服务器端也废弃 session. 但 takeover 模式我们是要保留 session 登录状态,
        // 所以只 close WebSocket (end), 不 logout.
        ctx.sock.end(undefined);
      } catch {
        // close 异常忽略
      }
      ctx.sock = null;
    }
    // 状态机: 如果已经 connected, 不改写; 否则 finalState 落地
    if (ctx.status.state !== 'connected') {
      ctx.status.state = finalState;
      ctx.status.error = errorMsg;
    }
    ctx.status.lastEventAt = new Date().toISOString();

    // 保留 ctx 在 Map 里约 30 秒, 让前端轮询到 final state; 之后清
    setTimeout(() => {
      if (this.contexts.get(ctx.slotId) === ctx) {
        this.contexts.delete(ctx.slotId);
      }
    }, 30_000);
  }
}
