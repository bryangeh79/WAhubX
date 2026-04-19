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
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AccountSlotEntity, AccountSlotStatus } from '../slots/account-slot.entity';
import { WaAccountEntity } from '../slots/wa-account.entity';
import { AccountHealthEntity, RiskLevel } from '../slots/account-health.entity';
import { ProxyEntity } from '../proxies/proxy.entity';
import { WaContactEntity } from './wa-contact.entity';
import { ChatMessageEntity, MessageDirection, MessageType } from './chat-message.entity';
import { getMediaDir, getWaSessionDir } from '../../common/storage';
import { ensureFingerprint, type SlotFingerprint } from '../../common/fingerprint';
import { buildProxyAgent, type ProxyDescriptor } from '../../common/proxy-config';

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
  // QR mode: raw string; 前端用 qrcode lib 渲图
  qr: string | null;
  // Pairing code mode: 8 位字母数字 (e.g. "ABCD-1234"); 用户在 WA → 链接设备 → 用手机号连接 输入
  pairingCode: string | null;
  // 绑定模式, 给前端决定显示 QR 还是 pairing code
  mode: 'qr' | 'pairing-code';
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
  // dev 排查代理时暴露 Baileys 内部错误; M3 走 config 按 NODE_ENV 切回 silent
  private readonly baileysLogger = pino({ level: 'warn' });
  // 动态拉来的 WA 版本, 进程生命周期复用避免反复请求
  private waVersion: number[] | null = null;
  // 自动重连状态: key=slotId, value={attempts, nextRetryTimer}
  // 策略: 指数退避 5s → 10s → 20s → 40s → 80s (cap), 累计 5 次还连不上则 suspend
  private readonly reconnectState = new Map<number, { attempts: number; timer: NodeJS.Timeout | null }>();
  private static readonly MAX_RECONNECT_ATTEMPTS = 5;
  private static readonly RECONNECT_BASE_MS = 5000;
  private static readonly RECONNECT_CAP_MS = 80_000;

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
    for (const slotId of [...this.reconnectState.keys()]) {
      this.clearReconnect(slotId);
    }
  }

  // ── Bind 流程 ─────────────────────────────────────────
  getStatus(slotId: number): BindStatusView {
    const ctx = this.bindContexts.get(slotId);
    if (!ctx) {
      return {
        state: 'idle',
        qr: null,
        pairingCode: null,
        mode: 'qr',
        phoneNumber: null,
        startedAt: new Date().toISOString(),
        lastEventAt: new Date().toISOString(),
        error: null,
      };
    }
    return { ...ctx.status };
  }

  async startBind(slotId: number, pairingPhoneNumber?: string): Promise<BindStatusView> {
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

    // pairingPhoneNumber 给定 → 走 pairing code 模式; 否则 QR
    const mode: 'qr' | 'pairing-code' = pairingPhoneNumber ? 'pairing-code' : 'qr';

    const ctx: BindContext = {
      slotId,
      slotIndex: slot.slotIndex,
      tenantId: slot.tenantId,
      sock: null,
      status: {
        state: 'starting',
        qr: null,
        pairingCode: null,
        mode,
        phoneNumber: pairingPhoneNumber ?? null,
        startedAt: new Date().toISOString(),
        lastEventAt: new Date().toISOString(),
        error: null,
      },
      timeoutHandle: null,
    };
    this.bindContexts.set(slotId, ctx);

    void this.spawnBindSocket(ctx, pairingPhoneNumber).catch((err) => {
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

  // ── 发消息: text (W2) + media (W3) ──────────────────────
  async sendMedia(
    slotId: number,
    to: string,
    type: 'image' | 'voice' | 'file',
    contentBase64: string,
    options: { mimeType?: string; filename?: string; caption?: string } = {},
  ): Promise<{ waMessageId: string | null; mediaPath: string | null }> {
    const sock = this.pool.get(slotId);
    if (!sock) {
      throw new BadRequestException(`槽位 ${slotId} 未在线 (pool 无 socket)`);
    }
    const slot = await this.dataSource
      .getRepository(AccountSlotEntity)
      .findOne({ where: { id: slotId } });
    if (!slot?.accountId) throw new BadRequestException(`槽位 ${slotId} 没有绑定账号`);

    const buffer = Buffer.from(contentBase64, 'base64');
    if (buffer.length === 0) throw new BadRequestException('contentBase64 解码后为空');
    if (buffer.length > 16 * 1024 * 1024) {
      throw new BadRequestException(`媒体大小超过 WA 16MB 上限 (${buffer.length} bytes)`);
    }
    const jid = this.normalizeJid(to);

    let sendPayload: Parameters<WASocket['sendMessage']>[1];
    let msgTypeEnum: MessageType;
    switch (type) {
      case 'image':
        sendPayload = { image: buffer, caption: options.caption };
        msgTypeEnum = MessageType.Image;
        break;
      case 'voice':
        sendPayload = {
          audio: buffer,
          ptt: true,
          mimetype: options.mimeType ?? 'audio/ogg; codecs=opus',
        };
        msgTypeEnum = MessageType.Voice;
        break;
      case 'file':
        sendPayload = {
          document: buffer,
          fileName: options.filename ?? 'file.bin',
          mimetype: options.mimeType ?? 'application/octet-stream',
          caption: options.caption,
        };
        msgTypeEnum = MessageType.File;
        break;
    }

    const sendResult = await sock.sendMessage(jid, sendPayload);
    const waMessageId = sendResult?.key?.id ?? null;

    // 落盘便于审计 (可选)
    let mediaPath: string | null = null;
    try {
      const ext = this.guessExtFromType(type, options.mimeType, options.filename);
      const filename = `${waMessageId ?? Date.now()}-out${ext}`;
      const abs = path.join(getMediaDir(slot.slotIndex), filename);
      fs.writeFileSync(abs, buffer);
      mediaPath = path.relative(process.cwd(), abs);
    } catch (err) {
      this.logger.warn(`slot ${slotId} outbound media 落盘失败: ${err}`);
    }

    await this.persistMessage({
      accountId: slot.accountId,
      remoteJid: jid,
      direction: MessageDirection.Out,
      msgType: msgTypeEnum,
      content: options.caption ?? null,
      mediaPath,
      sentAt: new Date(),
      waMessageId,
    });

    return { waMessageId, mediaPath };
  }

  private guessExtFromType(type: 'image' | 'voice' | 'file', mime?: string, filename?: string): string {
    if (filename && filename.includes('.')) return `.${filename.split('.').pop()}`;
    if (mime) {
      const sub = mime.split('/')[1]?.split(';')[0];
      if (sub) return `.${sub}`;
    }
    if (type === 'image') return '.jpg';
    if (type === 'voice') return '.ogg';
    return '.bin';
  }

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

  // 统一组装 makeWASocket 共用的隔离参数: fingerprint (browser[0]=model) + proxy agent
  // 所有 spawn 路径 (bind / rehydrate) 都经这里走
  private async resolveIsolation(params: {
    slotId: number;
    slotIndex: number;
    tenantId: number;
    proxyId: number | null;
  }): Promise<{
    fingerprint: SlotFingerprint;
    agent: ReturnType<typeof buildProxyAgent>;
    proxyDesc: ProxyDescriptor | null;
  }> {
    const fingerprint = ensureFingerprint({
      slotIndex: params.slotIndex,
      tenantId: params.tenantId,
    });

    let proxyDesc: ProxyDescriptor | null = null;
    if (params.proxyId !== null) {
      const proxy = await this.dataSource
        .getRepository(ProxyEntity)
        .findOne({ where: { id: params.proxyId } });
      if (!proxy) {
        this.logger.warn(`slot ${params.slotId} proxy_id=${params.proxyId} 不存在 DB, 回退直连`);
      } else {
        proxyDesc = {
          type: proxy.proxyType as ProxyDescriptor['type'],
          host: proxy.host,
          port: proxy.port,
          username: proxy.username,
          password: proxy.password,
        };
      }
    }
    const agent = buildProxyAgent(proxyDesc);
    if (proxyDesc) {
      this.logger.log(
        `slot ${params.slotId} using proxy ${proxyDesc.type}://${proxyDesc.host}:${proxyDesc.port} (${fingerprint.model})`,
      );
    } else {
      this.logger.log(`slot ${params.slotId} direct egress (no proxy) (${fingerprint.model})`);
    }
    return { fingerprint, agent, proxyDesc };
  }

  private async spawnBindSocket(ctx: BindContext, pairingPhoneNumber?: string): Promise<void> {
    const sessionDir = getWaSessionDir(ctx.slotIndex);
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const version = await this.ensureWaVersion();

    // 读 slot 的 proxy_id 决定出口 IP
    const slot = await this.dataSource
      .getRepository(AccountSlotEntity)
      .findOne({ where: { id: ctx.slotId } });
    const isolation = await this.resolveIsolation({
      slotId: ctx.slotId,
      slotIndex: ctx.slotIndex,
      tenantId: ctx.tenantId,
      proxyId: slot?.proxyId ?? null,
    });

    const sock = makeWASocket({
      version: version as [number, number, number],
      auth: state,
      printQRInTerminal: false,
      logger: this.baileysLogger,
      // fingerprint.baileysBrowser = [model, 'Desktop', chromeMajor] — 每槽独立, 跨会话稳定
      browser: isolation.fingerprint.baileysBrowser,
      // HttpsProxyAgent / SocksProxyAgent 运行时兼容 http.Agent 接口, TS 类型对不上 https.Agent 但
      // 功能等价 — 用 as never 绕开严格匹配
      agent: (isolation.agent ?? undefined) as never,
      fetchAgent: (isolation.agent ?? undefined) as never,
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });
    ctx.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    // Pairing code 要等 socket 完成 noise handshake (WA 开始请求 auth → qr 事件触发) 才能调,
    // 早调会 "Connection Closed". 用 flag 保证只调一次.
    let pairingRequested = false;

    sock.ev.on('connection.update', (update) => {
      const { connection, qr, lastDisconnect } = update;
      ctx.status.lastEventAt = new Date().toISOString();

      // QR 模式: 推给前端渲图
      if (qr && ctx.status.mode === 'qr') {
        ctx.status.state = 'qr';
        ctx.status.qr = qr;
      }

      // Pairing code 模式: qr 事件是"WA 准备接受 auth"的信号, 此时调 requestPairingCode 最稳
      if (qr && ctx.status.mode === 'pairing-code' && !pairingRequested && pairingPhoneNumber) {
        pairingRequested = true;
        void this.requestPairingCode(ctx, sock, pairingPhoneNumber);
      }

      if (connection === 'connecting') {
        if (ctx.status.state !== 'qr') ctx.status.state = 'connecting';
      }

      if (connection === 'open') {
        void this.onBindConnectionOpen(ctx, sock, saveCreds);
      }

      if (connection === 'close' && ctx.status.state !== 'connected') {
        const code =
          lastDisconnect?.error instanceof Boom
            ? (lastDisconnect.error as Boom).output.statusCode
            : 0;
        const reason = Object.entries(DisconnectReason).find(([, v]) => v === code)?.[0] ?? 'unknown';

        // restartRequired(515): 扫码/配对成功后 WA 要求拿新凭证重开连接.
        // Baileys 不会自动重启, 我们必须手动关旧 sock + 用同 auth state (现在 registered=true) spawn 新 sock.
        // 新 sock 会直接 open → onBindConnectionOpen 继续流程.
        if (code === DisconnectReason.restartRequired) {
          this.logger.log(`slot ${ctx.slotId} got restartRequired(515), respawning socket with registered creds`);
          ctx.status.state = 'connecting';
          ctx.status.lastEventAt = new Date().toISOString();
          try {
            ctx.sock?.end(undefined);
          } catch {
            // ignore
          }
          ctx.sock = null;
          // pairingPhoneNumber 传 undefined: 配对码只首次需要, 重启时 creds 已登记, 直接走 open 流
          void this.spawnBindSocket(ctx, undefined).catch((err) => {
            this.logger.error(`slot ${ctx.slotId} restart respawn failed: ${err}`);
            void this.teardownBind(ctx, 'failed', `重启 socket 失败 (${err})`);
          });
          return;
        }

        this.logger.warn(`slot ${ctx.slotId} bind connection closed: ${reason} (${code})`);
        void this.teardownBind(ctx, 'failed', `连接关闭 (${reason})`);
      }
    });
  }

  private async requestPairingCode(
    ctx: BindContext,
    sock: WASocket,
    pairingPhoneNumber: string,
  ): Promise<void> {
    try {
      if (sock.authState.creds.registered) return; // 已注册号不走配对码流
      const digits = pairingPhoneNumber.replace(/[^0-9]/g, '');
      if (!digits) throw new Error(`手机号 "${pairingPhoneNumber}" 无效`);
      const code = await sock.requestPairingCode(digits);
      const formatted = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
      ctx.status.state = 'qr'; // 复用 'qr' 态, UI 按 mode 展示配对码或 QR
      ctx.status.pairingCode = formatted;
      ctx.status.lastEventAt = new Date().toISOString();
      this.logger.log(`slot ${ctx.slotId} pairing code ready for ${digits}: ${formatted}`);
    } catch (err) {
      this.logger.error(`slot ${ctx.slotId} requestPairingCode failed: ${err}`);
      ctx.status.state = 'failed';
      ctx.status.error = err instanceof Error ? err.message : String(err);
      await this.teardownBind(ctx, 'failed', ctx.status.error);
    }
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
          // 槽位指纹入库 (fingerprint.json 已存在磁盘; DB 里也放一份便于查询 / 审计)
          deviceFingerprint: ensureFingerprint({ slotIndex: ctx.slotIndex, tenantId: ctx.tenantId }) as unknown as Record<string, unknown>,
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

      this.attachPoolListeners(ctx.slotId, ctx.slotIndex, accountId, sock, saveCreds);
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

    const slot = await this.dataSource
      .getRepository(AccountSlotEntity)
      .findOne({ where: { id: slotId } });
    const isolation = await this.resolveIsolation({
      slotId,
      slotIndex,
      tenantId: slot?.tenantId ?? -1,
      proxyId: slot?.proxyId ?? null,
    });

    if (!slot?.accountId) {
      throw new Error(`slot ${slotId} missing accountId during rehydrate`);
    }

    const sock = makeWASocket({
      version: version as [number, number, number],
      auth: state,
      printQRInTerminal: false,
      logger: this.baileysLogger,
      browser: isolation.fingerprint.baileysBrowser,
      // HttpsProxyAgent / SocksProxyAgent 运行时实现了 http.Agent 的接口但 TS 类型是 http.Agent;
      // Baileys 声明需要 https.Agent — 用 any 断言绕开 TS 严格匹配
      agent: (isolation.agent ?? undefined) as never,
      fetchAgent: (isolation.agent ?? undefined) as never,
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    this.attachPoolListeners(slotId, slotIndex, slot.accountId, sock, saveCreds);
    this.pool.set(slotId, sock);
  }

  private attachPoolListeners(
    slotId: number,
    slotIndex: number,
    accountId: number,
    sock: WASocket,
    saveCreds: () => Promise<void>,
  ): void {
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === 'open') {
        // 连上就重置重连计数
        const rs = this.reconnectState.get(slotId);
        if (rs) {
          rs.attempts = 0;
          if (rs.timer) {
            clearTimeout(rs.timer);
            rs.timer = null;
          }
        }
      }
      if (connection === 'close') {
        const code =
          lastDisconnect?.error instanceof Boom
            ? (lastDisconnect.error as Boom).output.statusCode
            : 0;
        if (code === DisconnectReason.loggedOut) {
          this.logger.warn(`slot ${slotId} logged out remotely — removing from pool + marking suspended`);
          this.pool.delete(slotId);
          this.clearReconnect(slotId);
          void this.markSlotSuspended(slotId);
        } else {
          // M2 W3: 短暂断线 → 指数退避重连; 超出 MAX 才降级 suspended
          this.pool.delete(slotId);
          this.scheduleReconnect(slotId, accountId, code);
        }
      }
    });

    sock.ev.on('messages.upsert', (evt) => {
      for (const msg of evt.messages) {
        void this.persistIncomingMessage(slotIndex, accountId, msg, evt.type === 'notify').catch((err) => {
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

  // ── 自动重连 (W3.1) ────────────────────────────────────
  private scheduleReconnect(slotId: number, accountId: number, closeCode: number): void {
    const rs = this.reconnectState.get(slotId) ?? { attempts: 0, timer: null };
    if (rs.timer) clearTimeout(rs.timer);

    if (rs.attempts >= BaileysService.MAX_RECONNECT_ATTEMPTS) {
      this.logger.error(
        `slot ${slotId} reached MAX reconnect attempts (${rs.attempts}), suspending. Last close code=${closeCode}`,
      );
      this.reconnectState.delete(slotId);
      void this.markSlotSuspended(slotId);
      return;
    }

    // 5s * 2^attempts, cap 80s: 5, 10, 20, 40, 80
    const delayMs = Math.min(
      BaileysService.RECONNECT_BASE_MS * Math.pow(2, rs.attempts),
      BaileysService.RECONNECT_CAP_MS,
    );
    rs.attempts += 1;
    this.logger.warn(
      `slot ${slotId} scheduling reconnect #${rs.attempts}/${BaileysService.MAX_RECONNECT_ATTEMPTS} in ${Math.round(delayMs / 1000)}s (close code=${closeCode})`,
    );

    rs.timer = setTimeout(() => {
      rs.timer = null;
      void this.attemptReconnect(slotId, accountId);
    }, delayMs);

    this.reconnectState.set(slotId, rs);
  }

  private async attemptReconnect(slotId: number, accountId: number): Promise<void> {
    try {
      const slot = await this.dataSource
        .getRepository(AccountSlotEntity)
        .findOne({ where: { id: slotId } });
      if (!slot || !slot.accountId || slot.accountId !== accountId) {
        // 槽被清过或换号了, 停止重连
        this.logger.log(`slot ${slotId} no longer owned by account ${accountId}, abort reconnect`);
        this.clearReconnect(slotId);
        return;
      }
      if (slot.status === AccountSlotStatus.Suspended || slot.status === AccountSlotStatus.Empty) {
        this.logger.log(`slot ${slotId} status=${slot.status}, abort reconnect`);
        this.clearReconnect(slotId);
        return;
      }
      this.logger.log(`slot ${slotId} attempting reconnect...`);
      await this.spawnPooledSocket(slotId, slot.slotIndex);
      // 成功后 connection=open 事件会在 listener 里清 reconnectState
    } catch (err) {
      this.logger.error(`slot ${slotId} reconnect attempt failed: ${err}`);
      // 重试下一轮 (attempts 已自增, 靠下次 connection close 触发 scheduleReconnect 继续退避)
      // 但如果 spawn 压根没起成功 socket, 不会再 emit close 事件 → 主动再调度
      this.scheduleReconnect(slotId, accountId, -1);
    }
  }

  private clearReconnect(slotId: number): void {
    const rs = this.reconnectState.get(slotId);
    if (rs?.timer) clearTimeout(rs.timer);
    this.reconnectState.delete(slotId);
  }

  private async persistIncomingMessage(
    slotIndex: number,
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
      msg.message?.videoMessage?.caption ??
      msg.message?.documentMessage?.caption ??
      null;
    const msgType = this.inferMsgType(msg);
    const sentAt = msg.messageTimestamp
      ? new Date(Number(msg.messageTimestamp) * 1000)
      : new Date();

    // 媒体消息: 同步下载到 data/slots/<N>/media/, 把相对路径存 media_path
    // 下载失败不阻塞 DB 落库 — 可能是网络 / 媒体已过期, 文本内容和元数据照样进表
    let mediaPath: string | null = null;
    if (msgType !== MessageType.Text && msgType !== MessageType.Other) {
      try {
        mediaPath = await this.downloadAndSaveMedia(slotIndex, msg, msgType);
      } catch (err) {
        this.logger.warn(`slot-index ${slotIndex} media download failed (msgId=${msg.key.id}): ${err}`);
      }
    }

    await this.persistMessage({
      accountId,
      remoteJid: msg.key.remoteJid,
      direction: MessageDirection.In,
      msgType,
      content: text,
      mediaPath,
      sentAt,
      waMessageId: msg.key.id ?? null,
      pushName: msg.pushName ?? null,
      updateContactLastMessageAt: isLive,
    });
  }

  private async downloadAndSaveMedia(
    slotIndex: number,
    msg: WAMessage,
    msgType: MessageType,
  ): Promise<string | null> {
    // downloadMediaMessage 返回 Buffer (默认) 或 stream
    const buffer = (await downloadMediaMessage(
      msg,
      'buffer',
      {},
      {
        logger: this.baileysLogger,
        // reuploadRequest 在需要 re-fetch URL 时调用; 简单用: 直接抛, Baileys 内部重试
        reuploadRequest: (async () => {
          throw new Error('reuploadRequest not implemented');
        }) as never,
      },
    )) as Buffer;

    if (!buffer || buffer.length === 0) return null;

    const ext = this.guessExt(msg, msgType);
    const filename = `${msg.key.id ?? Date.now()}${ext}`;
    const mediaDir = getMediaDir(slotIndex);
    const abs = path.join(mediaDir, filename);
    fs.writeFileSync(abs, buffer);

    // 存相对路径, 便于 data dir 迁移. 前端若要访问需走后端 serve-static (M9 接管 UI 再做)
    return path.relative(process.cwd(), abs);
  }

  private guessExt(msg: WAMessage, msgType: MessageType): string {
    const m = msg.message;
    if (!m) return '.bin';
    const mime =
      m.imageMessage?.mimetype ??
      m.audioMessage?.mimetype ??
      m.videoMessage?.mimetype ??
      m.documentMessage?.mimetype ??
      null;
    if (mime) {
      const sub = mime.split('/')[1]?.split(';')[0];
      if (sub) return `.${sub}`;
    }
    switch (msgType) {
      case MessageType.Image:
        return '.jpg';
      case MessageType.Voice:
        return '.ogg';
      case MessageType.File:
        return '.bin';
      default:
        return '.bin';
    }
  }

  private async persistMessage(params: {
    accountId: number;
    remoteJid: string;
    direction: MessageDirection;
    msgType: MessageType;
    content: string | null;
    mediaPath?: string | null;
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
        mediaPath: params.mediaPath ?? null,
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
    if (m.videoMessage) return MessageType.Image; // 先归到 image 大类; MessageType 枚举暂无 video
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

  // slots.clear 用: 把 pool 中的 socket 强制退出 + 取消重连
  async evictFromPool(slotId: number): Promise<void> {
    this.clearReconnect(slotId);
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
