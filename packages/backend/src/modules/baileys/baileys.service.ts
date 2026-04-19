// M2 Week 2: 在 W1 bind-existing 基础上加常驻 socket pool + 消息收发
//
// 职责:
//   1. BindContext Map — 进行中的 bind (QR 轮询) 短生命周期
//   2. Pool Map<slotId, WASocket> — 已绑定账号的常驻 socket, 进程运行期保持在线
//   3. onModuleInit: 读 DB 所有 slot.status in (warmup, active) + session_path 存在的, 批量 rehydrate
//   4. bind 成功后: 不再 end(), 交给 pool; 持续监听 messages.upsert 入 DB
//   5. sendText(slotId, to, text): 通过 pool 里的 socket 发
//
// 不做 (留后续):
//   - 自动重连策略 (目前断线后直接移出 pool, 需手动 rebind) — M2 W3
//   - 图片/语音/文件 — M2 W3 / M7
//   - 消息去重 / 撤回 — M9
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Boom } from '@hapi/boom';
import { DataSource, Repository } from 'typeorm';
import {
  type WAMessage,
  type WASocket,
  DisconnectReason,
  default as makeWASocket,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import * as fs from 'node:fs';
import { AccountSlotEntity, AccountSlotStatus } from '../slots/account-slot.entity';
import { WaAccountEntity } from '../slots/wa-account.entity';
import { AccountHealthEntity, RiskLevel } from '../slots/account-health.entity';
import { WaContactEntity } from './wa-contact.entity';
import { ChatMessageEntity, MessageDirection, MessageType } from './chat-message.entity';
import { getWaSessionDir } from '../../common/storage';

export type BindState =
  | 'idle'
  | 'starting'
  | 'qr'
  | 'connecting'
  | 'connected'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export interface BindStatusView {
  state: BindState;
  qr: string | null;
  phoneNumber: string | null;
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

const BIND_TIMEOUT_MS = 2 * 60 * 1000;

@Injectable()
export class BaileysService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BaileysService.name);
  private readonly bindContexts = new Map<number, BindContext>();
  // 已绑定账号的常驻 socket 池: key=slotId
  private readonly pool = new Map<number, WASocket>();
  private readonly baileysLogger = pino({ level: 'silent' });
  // 动态拉来的 WA 版本, 进程生命周期复用避免反复请求
  private waVersion: number[] | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(WaContactEntity) private readonly contactRepo: Repository<WaContactEntity>,
    @InjectRepository(ChatMessageEntity) private readonly messageRepo: Repository<ChatMessageEntity>,
  ) {}

  // ── 生命周期 ────────────────────────────────────────────
  async onModuleInit(): Promise<void> {
    try {
      const { version, isLatest } = await fetchLatestBaileysVersion();
      this.waVersion = version;
      this.logger.log(`Baileys WA version ${version.join('.')} (isLatest=${isLatest})`);
    } catch (err) {
      this.logger.warn(`fetchLatestBaileysVersion failed, will retry per-bind: ${err}`);
    }

    const slots = await this.dataSource
      .getRepository(AccountSlotEntity)
      .createQueryBuilder('s')
      .where('s.status IN (:...st)', { st: [AccountSlotStatus.Warmup, AccountSlotStatus.Active] })
      .andWhere('s.account_id IS NOT NULL')
      .getMany();

    for (const slot of slots) {
      const sessionDir = getWaSessionDir(slot.slotIndex);
      if (!fs.existsSync(sessionDir) || fs.readdirSync(sessionDir).length === 0) {
        this.logger.warn(`slot ${slot.id}: 状态=${slot.status} 但 session 文件缺失, 跳过 rehydrate`);
        continue;
      }
      try {
        await this.spawnPooledSocket(slot.id, slot.slotIndex);
        this.logger.log(`rehydrated slot ${slot.id} (index ${slot.slotIndex})`);
      } catch (err) {
        this.logger.error(`rehydrate slot ${slot.id} failed: ${err}`);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const ctx of this.bindContexts.values()) {
      await this.teardownBind(ctx, 'cancelled', 'shutdown');
    }
    this.bindContexts.clear();
    for (const [slotId, sock] of this.pool) {
      try {
        sock.end(undefined);
      } catch {
        // ignore
      }
      this.pool.delete(slotId);
    }
  }

  // ── Bind 流程 ─────────────────────────────────────────
  getStatus(slotId: number): BindStatusView {
    const ctx = this.bindContexts.get(slotId);
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
    const slot = await this.dataSource
      .getRepository(AccountSlotEntity)
      .findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException(`槽位 ${slotId} 不存在`);
    if (slot.status !== AccountSlotStatus.Empty) {
      throw new BadRequestException(
        `槽位 ${slotId} 当前状态 ${slot.status}, 只有 empty 槽位可绑定新号`,
      );
    }

    const existing = this.bindContexts.get(slotId);
    if (existing && ['qr', 'connecting', 'starting'].includes(existing.status.state)) {
      return { ...existing.status };
    }
    if (existing) await this.teardownBind(existing, 'cancelled', 'restarted');

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
    this.bindContexts.set(slotId, ctx);

    void this.spawnBindSocket(ctx).catch((err) => {
      this.logger.error(`slot ${slotId} spawnBindSocket failed: ${err}`);
      ctx.status.state = 'failed';
      ctx.status.error = err instanceof Error ? err.message : String(err);
      ctx.status.lastEventAt = new Date().toISOString();
    });

    ctx.timeoutHandle = setTimeout(() => {
      void this.teardownBind(ctx, 'timeout', '2 分钟内未完成扫码');
    }, BIND_TIMEOUT_MS);

    return { ...ctx.status };
  }

  async cancelBind(slotId: number): Promise<BindStatusView> {
    const ctx = this.bindContexts.get(slotId);
    if (!ctx) return this.getStatus(slotId);
    await this.teardownBind(ctx, 'cancelled', 'user cancelled');
    return { ...ctx.status };
  }

  // ── 发消息 (M2 W2 只支持 text) ─────────────────────────
  async sendText(slotId: number, to: string, text: string): Promise<{ waMessageId: string | null }> {
    const sock = this.pool.get(slotId);
    if (!sock) {
      throw new BadRequestException(
        `槽位 ${slotId} 未在线 (pool 无 socket). 先完成扫码绑定 / 等 rehydrate 完成.`,
      );
    }
    const jid = this.normalizeJid(to);
    const slot = await this.dataSource
      .getRepository(AccountSlotEntity)
      .findOne({ where: { id: slotId } });
    if (!slot?.accountId) throw new BadRequestException(`槽位 ${slotId} 没有绑定账号`);

    const sendResult = await sock.sendMessage(jid, { text });
    const waMessageId = sendResult?.key?.id ?? null;

    await this.persistMessage({
      accountId: slot.accountId,
      remoteJid: jid,
      direction: MessageDirection.Out,
      msgType: MessageType.Text,
      content: text,
      sentAt: new Date(),
      waMessageId,
    });

    return { waMessageId };
  }

  // ── 读取 (controller 用) ───────────────────────────────
  async listContacts(accountId: number) {
    return this.contactRepo.find({
      where: { accountId },
      order: { lastMessageAt: 'DESC' },
    });
  }

  async listMessages(
    accountId: number,
    opts: { contactId?: number; limit?: number; beforeId?: string },
  ) {
    const qb = this.messageRepo
      .createQueryBuilder('m')
      .where('m.account_id = :aid', { aid: accountId });
    if (opts.contactId) qb.andWhere('m.contact_id = :cid', { cid: opts.contactId });
    if (opts.beforeId) qb.andWhere('m.id < :bid', { bid: opts.beforeId });
    return qb
      .orderBy('m.id', 'DESC')
      .take(Math.min(200, Math.max(1, opts.limit ?? 50)))
      .getMany();
  }

  // ── 内部: socket 生命周期 ─────────────────────────────
  private async ensureWaVersion(): Promise<number[]> {
    if (this.waVersion) return this.waVersion;
    const { version } = await fetchLatestBaileysVersion();
    this.waVersion = version;
    return version;
  }

  private async spawnBindSocket(ctx: BindContext): Promise<void> {
    const sessionDir = getWaSessionDir(ctx.slotIndex);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const version = await this.ensureWaVersion();

    const sock = makeWASocket({
      version: version as [number, number, number],
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
      }
      if (connection === 'connecting') ctx.status.state = 'connecting';

      if (connection === 'open') {
        void this.onBindConnectionOpen(ctx, sock, saveCreds);
      }

      if (connection === 'close' && ctx.status.state !== 'connected') {
        const code =
          lastDisconnect?.error instanceof Boom
            ? (lastDisconnect.error as Boom).output.statusCode
            : 0;
        const reason = Object.entries(DisconnectReason).find(([, v]) => v === code)?.[0] ?? 'unknown';
        this.logger.warn(`slot ${ctx.slotId} bind connection closed: ${reason} (${code})`);
        void this.teardownBind(ctx, 'failed', `连接关闭 (${reason})`);
      }
    });
  }

  /**
   * 扫码成功: DB 落库 + 把 socket 转给 pool 常驻 (*不* 关闭 socket, W1 行为变更)
   */
  private async onBindConnectionOpen(
    ctx: BindContext,
    sock: WASocket,
    saveCreds: () => Promise<void>,
  ): Promise<void> {
    try {
      if (!sock.user?.id) throw new Error('socket.user.id 缺失');
      const phone = sock.user.id.split(':')[0].split('@')[0];
      const sessionPath = getWaSessionDir(ctx.slotIndex);

      let accountId!: number;
      await this.dataSource.transaction(async (manager) => {
        const slot = await manager.findOne(AccountSlotEntity, { where: { id: ctx.slotId } });
        if (!slot) throw new Error(`slot ${ctx.slotId} 不存在 (race)`);

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
        accountId = savedAccount.id;

        await manager.save(
          manager.create(AccountHealthEntity, {
            accountId: savedAccount.id,
            healthScore: 100,
            riskLevel: RiskLevel.Low,
            riskFlags: [],
            totalSent: 0,
            totalReceived: 0,
          }),
        );

        slot.accountId = savedAccount.id;
        slot.status = AccountSlotStatus.Warmup;
        slot.profilePath = sessionPath;
        await manager.save(slot);
      });

      ctx.status.state = 'connected';
      ctx.status.phoneNumber = phone;
      ctx.status.lastEventAt = new Date().toISOString();
      this.logger.log(`slot ${ctx.slotId} bound phone ${phone}, handing off to pool`);

      this.attachPoolListeners(ctx.slotId, accountId, sock, saveCreds);
      this.pool.set(ctx.slotId, sock);

      if (ctx.timeoutHandle) {
        clearTimeout(ctx.timeoutHandle);
        ctx.timeoutHandle = null;
      }
      setTimeout(() => {
        if (this.bindContexts.get(ctx.slotId) === ctx) this.bindContexts.delete(ctx.slotId);
      }, 30_000);
    } catch (err) {
      this.logger.error(`slot ${ctx.slotId} onBindConnectionOpen failed: ${err}`);
      ctx.status.state = 'failed';
      ctx.status.error = err instanceof Error ? err.message : String(err);
      await this.teardownBind(ctx, 'failed', ctx.status.error);
    }
  }

  /**
   * Rehydrate 路径: 从磁盘 session 起常驻 socket, 挂到 pool.
   * creds 已失效时 pool listener 会收到 close(loggedOut), 自动移出 pool.
   */
  private async spawnPooledSocket(slotId: number, slotIndex: number): Promise<void> {
    const sessionDir = getWaSessionDir(slotIndex);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const version = await this.ensureWaVersion();

    const sock = makeWASocket({
      version: version as [number, number, number],
      auth: state,
      printQRInTerminal: false,
      logger: this.baileysLogger,
      browser: ['WAhubX', 'Desktop', '1.0.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    const slot = await this.dataSource
      .getRepository(AccountSlotEntity)
      .findOne({ where: { id: slotId } });
    if (!slot?.accountId) {
      sock.end(undefined);
      throw new Error(`slot ${slotId} missing accountId during rehydrate`);
    }
    this.attachPoolListeners(slotId, slot.accountId, sock, saveCreds);
    this.pool.set(slotId, sock);
  }

  private attachPoolListeners(
    slotId: number,
    accountId: number,
    sock: WASocket,
    saveCreds: () => Promise<void>,
  ): void {
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === 'close') {
        const code =
          lastDisconnect?.error instanceof Boom
            ? (lastDisconnect.error as Boom).output.statusCode
            : 0;
        if (code === DisconnectReason.loggedOut) {
          this.logger.warn(`slot ${slotId} logged out remotely — removing from pool + marking suspended`);
          this.pool.delete(slotId);
          void this.markSlotSuspended(slotId);
        } else {
          this.logger.warn(`slot ${slotId} pool socket closed (code=${code}), removing from pool (无自动重连, M2 W3)`);
          this.pool.delete(slotId);
        }
      }
    });

    sock.ev.on('messages.upsert', (evt) => {
      for (const msg of evt.messages) {
        void this.persistIncomingMessage(accountId, msg, evt.type === 'notify').catch((err) => {
          this.logger.error(`slot ${slotId} persist inbound failed: ${err}`);
        });
      }
    });
  }

  private async markSlotSuspended(slotId: number): Promise<void> {
    await this.dataSource
      .getRepository(AccountSlotEntity)
      .update(slotId, { status: AccountSlotStatus.Suspended });
  }

  private async persistIncomingMessage(
    accountId: number,
    msg: WAMessage,
    isLive: boolean,
  ): Promise<void> {
    if (!msg.key.remoteJid) return;
    if (msg.key.fromMe) return;

    const text =
      msg.message?.conversation ??
      msg.message?.extendedTextMessage?.text ??
      msg.message?.imageMessage?.caption ??
      null;
    const msgType = this.inferMsgType(msg);
    const sentAt = msg.messageTimestamp
      ? new Date(Number(msg.messageTimestamp) * 1000)
      : new Date();

    await this.persistMessage({
      accountId,
      remoteJid: msg.key.remoteJid,
      direction: MessageDirection.In,
      msgType,
      content: text,
      sentAt,
      waMessageId: msg.key.id ?? null,
      pushName: msg.pushName ?? null,
      updateContactLastMessageAt: isLive,
    });
  }

  private async persistMessage(params: {
    accountId: number;
    remoteJid: string;
    direction: MessageDirection;
    msgType: MessageType;
    content: string | null;
    sentAt: Date;
    waMessageId: string | null;
    pushName?: string | null;
    updateContactLastMessageAt?: boolean;
  }): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      let contact = await manager.findOne(WaContactEntity, {
        where: { accountId: params.accountId, remoteJid: params.remoteJid },
      });
      if (!contact) {
        contact = manager.create(WaContactEntity, {
          accountId: params.accountId,
          remoteJid: params.remoteJid,
          displayName: params.pushName ?? null,
          lastMessageAt: (params.updateContactLastMessageAt ?? true) ? params.sentAt : null,
        });
        contact = await manager.save(contact);
      } else {
        const patch: { displayName?: string | null; lastMessageAt?: Date } = {};
        if (!contact.displayName && params.pushName) patch.displayName = params.pushName;
        if (params.updateContactLastMessageAt ?? true) patch.lastMessageAt = params.sentAt;
        if (Object.keys(patch).length > 0) {
          await manager.update(WaContactEntity, contact.id, patch);
        }
      }

      const msg = manager.create(ChatMessageEntity, {
        accountId: params.accountId,
        contactId: contact.id,
        direction: params.direction,
        msgType: params.msgType,
        content: params.content,
        sentAt: params.sentAt,
        waMessageId: params.waMessageId,
      });
      await manager.save(msg);
    });
  }

  private inferMsgType(msg: WAMessage): MessageType {
    const m = msg.message;
    if (!m) return MessageType.Other;
    if (m.conversation || m.extendedTextMessage) return MessageType.Text;
    if (m.imageMessage) return MessageType.Image;
    if (m.audioMessage) return MessageType.Voice;
    if (m.documentMessage) return MessageType.File;
    return MessageType.Other;
  }

  private normalizeJid(input: string): string {
    const trimmed = input.trim();
    if (trimmed.includes('@')) return trimmed;
    const digits = trimmed.replace(/[^0-9]/g, '');
    if (!digits) throw new BadRequestException(`手机号 "${input}" 无效`);
    return `${digits}@s.whatsapp.net`;
  }

  private async teardownBind(
    ctx: BindContext,
    finalState: BindState,
    errorMsg: string | null,
  ): Promise<void> {
    if (ctx.timeoutHandle) {
      clearTimeout(ctx.timeoutHandle);
      ctx.timeoutHandle = null;
    }
    if (ctx.sock) {
      try {
        ctx.sock.end(undefined);
      } catch {
        // ignore
      }
      ctx.sock = null;
    }
    if (ctx.status.state !== 'connected') {
      ctx.status.state = finalState;
      ctx.status.error = errorMsg;
    }
    ctx.status.lastEventAt = new Date().toISOString();

    setTimeout(() => {
      if (this.bindContexts.get(ctx.slotId) === ctx) this.bindContexts.delete(ctx.slotId);
    }, 30_000);
  }

  // slots.clear 用: 把 pool 中的 socket 强制退出
  async evictFromPool(slotId: number): Promise<void> {
    const sock = this.pool.get(slotId);
    if (!sock) return;
    try {
      sock.end(undefined);
    } catch {
      // ignore
    }
    this.pool.delete(slotId);
  }

  isInPool(slotId: number): boolean {
    return this.pool.has(slotId);
  }
}
