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
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
import { OnEvent } from '@nestjs/event-emitter';
import { AccountSlotEntity, AccountSlotStatus } from '../slots/account-slot.entity';
import { TenantEntity } from '../tenants/tenant.entity';
import { BaileysWorkerManagerService, WORKER_MODE_ENABLED } from './worker/baileys-worker-manager.service';
import type { MessageUpsertEvent, ConnectionOpenEvent, ConnectionCloseEvent } from './worker/worker-protocol';
import { WaAccountEntity } from '../slots/wa-account.entity';
import { AccountHealthEntity, RiskLevel } from '../slots/account-health.entity';
import { ProxyEntity } from '../proxies/proxy.entity';
import { WaContactEntity } from './wa-contact.entity';
import { ChatMessageEntity, MessageDirection, MessageType } from './chat-message.entity';
import { StatusCacheService } from './status-cache.service';
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
  // 自动重连状态: key=slotId, value={attempts, nextRetryTimer, consecutive440Count}
  // 2026-04-25 稳定性重构: 指数退避 + jitter · 连续 2 次 440 直接 quarantine (不再烧号)
  private readonly reconnectState = new Map<
    number,
    {
      attempts: number;
      timer: NodeJS.Timeout | null;
      stableTimer?: NodeJS.Timeout | null;
      last440?: boolean;
      consecutive440?: number;
    }
  >();
  // 总重试上限 (非 440) · 440 上限单独走 QUARANTINE_440_THRESHOLD
  private static readonly MAX_RECONNECT_ATTEMPTS = 5;
  // 2026-04-25 · 指数退避基数 · 实际: 60s × 2^attempt × jitter(0.7-1.3)
  //   attempt=0 → ~60s · =1 → ~120s · =2 → ~240s · =3 → ~480s · =4 → ~960s
  // 比旧线性 30/60/90/120/150s 更温和 · 连 WA 次数少 · WA 侧信号少
  private static readonly RECONNECT_BASE_MS = 60_000;
  // 连续 2 次 440 (connectionReplaced) 就进 Quarantine · 不再自动重试
  // 因为每次重连都是一次 "尝试在别处登录" 信号 · 越试 WA 越踢
  private static readonly QUARANTINE_440_THRESHOLD = 2;
  // suspended 冷却期 · 30 min 内其他路径不允许翻回 active
  private static readonly SUSPEND_COOLDOWN_MS = 30 * 60 * 1000;
  // 心跳写 DB 频率
  private static readonly HEARTBEAT_INTERVAL_MS = 60 * 1000;
  // 心跳监控定时器
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(WaContactEntity) private readonly contactRepo: Repository<WaContactEntity>,
    @InjectRepository(ChatMessageEntity) private readonly messageRepo: Repository<ChatMessageEntity>,
    // M9 · Optional for back-compat · app 真正启动总会注入 (EventEmitterModule.forRoot 全局)
    @Optional() private readonly eventBus?: EventEmitter2,
    // 2026-04-22 · Status feed 缓存 · 给 status_browse/bulk/react executor 共用
    @Optional() private readonly statusCache?: StatusCacheService,
    // 2026-04-25 · Phase 2 · 子进程隔离 · WA_WORKER_MODE 开时 sendText/incoming msg 走 worker
    @Optional() private readonly workerManager?: BaileysWorkerManagerService,
  ) {}

  // ── 生命周期 ────────────────────────────────────────────
  async onModuleInit(): Promise<void> {
    // 2026-04-24 · dev freeze gate · 设 WA_FREEZE_ALL=true 跳过 rehydrate + 定时恢复
    // 用于开发期不惊动现有在线号 · 完成后 unset env 并重启
    if (process.env.WA_FREEZE_ALL === 'true' || process.env.WA_FREEZE_ALL === '1') {
      this.logger.warn('⚠ WA_FREEZE_ALL=true · 跳过所有 slot rehydrate 和 periodic recovery');
      return;
    }

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

    // 2026-04-22 · 错开启动 · 避免同 IP 同秒批量新连接触发 WA 风控
    // 观察到 · backend 重启时 4 号同时 spawn · WA 返 408 init-queries + 440 replaced 循环
    const STAGGER_MS = 10_000;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const sessionDir = getWaSessionDir(slot.slotIndex);
      if (!fs.existsSync(sessionDir) || fs.readdirSync(sessionDir).length === 0) {
        this.logger.warn(`slot ${slot.id}: 状态=${slot.status} 但 session 文件缺失, 跳过 rehydrate`);
        continue;
      }
      if (i > 0) {
        this.logger.log(`rehydrate · 等 ${STAGGER_MS / 1000}s 再起下一 slot (防 WA 风控)`);
        await new Promise((r) => setTimeout(r, STAGGER_MS));
      }
      try {
        await this.spawnPooledSocket(slot.id, slot.slotIndex);
        this.logger.log(`rehydrated slot ${slot.id} (index ${slot.slotIndex})`);
      } catch (err) {
        this.logger.error(`rehydrate slot ${slot.id} failed: ${err}`);
      }
    }

    // 2026-04-22 · Gap 3 · 定时静默重试 suspended 槽位 · 每 20 min 扫一次
    // 给"手机暂时开 WA"场景自动恢复 · 不用租户手点
    this.recoveryInterval = setInterval(() => {
      void this.periodicRecoveryTick().catch((err) =>
        this.logger.warn(`periodicRecoveryTick error: ${err}`),
      );
    }, 20 * 60 * 1000);
    this.logger.log('periodic suspended-slot recovery enabled · every 20 min');

    // 2026-04-25 · 心跳监控 · 每 60s 扫 pool · 活 socket 写 socket_last_heartbeat_at
    // UI 可据此判真存活 (DB status 只代表意图 · 心跳代表真实)
    this.heartbeatInterval = setInterval(() => {
      void this.heartbeatTick().catch((err) =>
        this.logger.warn(`heartbeatTick error: ${err}`),
      );
    }, BaileysService.HEARTBEAT_INTERVAL_MS);
  }

  // 2026-04-25 · pool 中有活 socket 的 slot 写入心跳戳
  // 判活标准: this.pool.has(slotId) && sock.ws?.readyState === OPEN
  private async heartbeatTick(): Promise<void> {
    if (this.pool.size === 0) return;
    const aliveSlotIds: number[] = [];
    for (const [slotId, sock] of this.pool.entries()) {
      try {
        // baileys WASocket 底层暴露 ws (WebSocket) · readyState 1=OPEN
        const ws = (sock as unknown as { ws?: { readyState?: number } }).ws;
        if (ws?.readyState === 1) aliveSlotIds.push(slotId);
      } catch {
        /* ignore */
      }
    }
    if (aliveSlotIds.length === 0) return;
    await this.dataSource
      .createQueryBuilder()
      .update(AccountSlotEntity)
      .set({ socketLastHeartbeatAt: () => 'NOW()' })
      .whereInIds(aliveSlotIds)
      .execute();
  }

  private recoveryInterval: NodeJS.Timeout | null = null;

  private async periodicRecoveryTick(): Promise<void> {
    // 只捞 suspended · 不捞 quarantine (明确判死 · 不再自动碰)
    const suspended = await this.dataSource
      .getRepository(AccountSlotEntity)
      .createQueryBuilder('s')
      .where('s.status = :st', { st: AccountSlotStatus.Suspended })
      .andWhere('s.account_id IS NOT NULL')
      .getMany();
    if (suspended.length === 0) return;
    const now = Date.now();
    const candidates = suspended.filter((slot) => {
      // 2026-04-25 · 冷却期内 (suspended_until 未到) · 不碰
      if (slot.suspendedUntil && new Date(slot.suspendedUntil).getTime() > now) return false;
      // 距离最近断连 < 15 min 也不试 · 让风控冷却 (旧逻辑保留作为双保险)
      const close = this.lastCloseInfo.get(slot.id);
      if (close && now - new Date(close.at).getTime() < 15 * 60 * 1000) return false;
      return true;
    });
    if (candidates.length === 0) {
      this.logger.log(`periodic recovery · 有 ${suspended.length} 个 suspended 槽位 · 全部仍在冷却期 · 跳过`);
      return;
    }
    this.logger.log(`periodic recovery · 尝试 ${candidates.length} 个 suspended 槽位 (过滤后)`);
    for (const slot of candidates) {
      try {
        await this.reactivateAndRespawn(slot.id);
      } catch (err) {
        this.logger.warn(`periodic recovery · slot ${slot.id} 失败: ${err}`);
      }
      // 分散 · 每个 slot 间隔 10s 避免同时冲风控
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }

  // 2026-04-21 · executor 需要直接调 Baileys 高级 API (加群/关频道/读消息)
  // 暴露 getSocket 让 JoinGroupExecutor / FollowChannelExecutor / StatusReactExecutor 等使用
  getSocket(slotId: number): WASocket | null {
    return this.pool.get(slotId) ?? null;
  }

  /**
   * 2026-04-22 · 注册流程完成后 · 把新 session 拉起来进 pool
   * 前提: session dir 已被 RegistrationService 写入 creds.json
   */
  async rehydrateSlot(slotId: number): Promise<void> {
    const slot = await this.dataSource
      .getRepository(AccountSlotEntity)
      .findOne({ where: { id: slotId } });
    if (!slot) throw new Error(`slot ${slotId} not found`);
    await this.spawnPooledSocket(slot.id, slot.slotIndex);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
      this.recoveryInterval = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
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

    // 2026-04-25 · 绑号冷却 · 防同租户短时间绑多号触发 WA 关联检测
    const cooldownSec = Number(process.env.TENANT_BIND_COOLDOWN_SEC ?? 600);
    const tenant = await this.dataSource
      .getRepository(TenantEntity)
      .findOne({ where: { id: slot.tenantId } });
    if (tenant?.lastBindAt) {
      const elapsed = (Date.now() - new Date(tenant.lastBindAt).getTime()) / 1000;
      if (elapsed < cooldownSec) {
        const remaining = Math.ceil(cooldownSec - elapsed);
        throw new BadRequestException(
          `租户刚绑过号 · 请等待 ${Math.ceil(remaining / 60)} 分钟 (${remaining}s) 再绑下一个 · 防 WA 关联检测`,
        );
      }
    }
    // 先打戳 · 防并发两个 bind 同时过检查
    await this.dataSource
      .getRepository(TenantEntity)
      .update(slot.tenantId, { lastBindAt: new Date() });

    const existing = this.bindContexts.get(slotId);
    if (existing && ['qr', 'connecting', 'starting'].includes(existing.status.state)) {
      return { ...existing.status };
    }
    if (existing) await this.teardownBind(existing, 'cancelled', 'restarted');

    // 2026-04-22 · 空槽重新绑定前 · 强制清残留 session 文件
    // 避免上次失败留下的 stale creds 被加载 · WA 返 badSession
    const sessionDir = getWaSessionDir(slot.slotIndex);
    if (fs.existsSync(sessionDir)) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
        this.logger.log(`slot ${slotId} · 清理残留 session (${sessionDir}) · 防 badSession`);
      } catch (err) {
        this.logger.warn(`slot ${slotId} · 清理 session 失败: ${err}`);
      }
    }

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
    type: 'image' | 'video' | 'voice' | 'file',
    contentBase64: string,
    options: { mimeType?: string; filename?: string; caption?: string } = {},
  ): Promise<{ waMessageId: string | null; mediaPath: string | null }> {
    const sock = this.pool.get(slotId);
    if (!sock) {
      const friendly = await this.friendlySlotName(slotId);
      throw new BadRequestException(`${friendly} 未在线 (pool 无 socket)`);
    }
    const slot = await this.dataSource
      .getRepository(AccountSlotEntity)
      .findOne({ where: { id: slotId } });
    if (!slot?.accountId) throw new BadRequestException(`${await this.friendlySlotName(slotId)} 没有绑定账号`);

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
      case 'video':
        sendPayload = {
          video: buffer,
          caption: options.caption,
          mimetype: options.mimeType ?? 'video/mp4',
        };
        msgTypeEnum = MessageType.Video;
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

    // 2026-04-24 · 媒体也模拟在线状态 · 语音用 recording, 其他用 composing (按 caption 长度计时)
    const presenceType: 'recording' | 'composing' = type === 'voice' ? 'recording' : 'composing';
    const fakeTextForTiming = options.caption ?? (type === 'voice' ? ' '.repeat(30) : ' '.repeat(12));
    await this.simulateTyping(sock, jid, fakeTextForTiming, presenceType);

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

  /**
   * 真人打字/录音模拟 · 发消息前 subscribe + composing/recording + sleep + paused
   * 硬编码规则 (不走 app_setting):
   *   - 每字 80-150ms 随机
   *   - 下限 1500ms · 上限 8000ms
   *   - presence 失败 (对方屏蔽 / socket 抖动) → 忽略, 不阻断 sendMessage
   */
  private async simulateTyping(
    sock: WASocket,
    jid: string,
    text: string,
    presenceType: 'composing' | 'recording' = 'composing',
  ): Promise<void> {
    const len = (text ?? '').length;
    // 每字 80-150ms 随机
    const perChar = 80 + Math.random() * 70;
    const rawMs = Math.round(len * perChar);
    const typingMs = Math.min(8000, Math.max(1500, rawMs));
    try {
      await sock.presenceSubscribe(jid);
      await sock.sendPresenceUpdate(presenceType, jid);
      await new Promise((r) => setTimeout(r, typingMs));
      await sock.sendPresenceUpdate('paused', jid);
    } catch (err) {
      // presence 任何失败不影响真正发送
      this.logger.debug(
        `simulateTyping(${presenceType}) ignored error on ${jid}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  private guessExtFromType(type: 'image' | 'video' | 'voice' | 'file', mime?: string, filename?: string): string {
    if (filename && filename.includes('.')) return `.${filename.split('.').pop()}`;
    if (mime) {
      const sub = mime.split('/')[1]?.split(';')[0];
      if (sub) return `.${sub}`;
    }
    if (type === 'image') return '.jpg';
    if (type === 'video') return '.mp4';
    if (type === 'voice') return '.ogg';
    return '.bin';
  }

  async sendText(slotId: number, to: string, text: string): Promise<{ waMessageId: string | null }> {
    const jid = this.normalizeJid(to);
    const slot = await this.dataSource
      .getRepository(AccountSlotEntity)
      .findOne({ where: { id: slotId } });
    if (!slot?.accountId) throw new BadRequestException(`${await this.friendlySlotName(slotId)} 没有绑定账号`);

    // 2026-04-25 · Phase 2 · WA_WORKER_MODE=true 且 worker 已起 · 走子进程
    // typing 模拟在 worker 内做 (通过 send-presence 命令) · 这里先发 presence 再 send-text
    if (WORKER_MODE_ENABLED() && this.workerManager?.hasWorker(slotId)) {
      // 打字模拟: composing + 1.5-8s 延迟 + paused
      try {
        const len = (text ?? '').length;
        const perChar = 80 + Math.random() * 70;
        const typingMs = Math.min(8000, Math.max(1500, Math.round(len * perChar)));
        await this.workerManager.sendPresence(slotId, jid, 'composing');
        await new Promise((r) => setTimeout(r, typingMs));
        await this.workerManager.sendPresence(slotId, jid, 'paused');
      } catch {
        /* 模拟失败不阻断 */
      }
      const ret = await this.workerManager.sendText(slotId, jid, text);
      const waMessageId = ret.waMessageId;
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

    // 老路径 · Phase 1 行为
    const sock = this.pool.get(slotId);
    if (!sock) {
      throw new BadRequestException(
        `${await this.friendlySlotName(slotId)} 未在线 (pool 无 socket). 先完成扫码绑定 / 等 rehydrate 完成.`,
      );
    }

    // 2026-04-24 · 真人打字模拟 · 默认开 · 对方看到 "正在输入..." 几秒再收到消息
    // 硬编码: 每字 80-150ms 随机 · 下限 1.5s · 上限 8s · 失败不阻断发送
    await this.simulateTyping(sock, jid, text, 'composing');

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

  /**
   * 发纯文本 Status (24h WA 动态). M5 养号日历 Phase 2+ 用.
   * Baileys: jid = 'status@broadcast', 消息本身是 text/image/video.
   * 返 null waMessageId 仍写 chat_message (msg_type=status) 便于日历幂等与统计.
   */
  async sendStatusText(slotId: number, text: string): Promise<{ waMessageId: string | null }> {
    const sock = this.pool.get(slotId);
    if (!sock) {
      throw new BadRequestException(
        `${await this.friendlySlotName(slotId)} 未在线 (pool 无 socket). 先完成扫码绑定 / 等 rehydrate 完成.`,
      );
    }
    const slot = await this.dataSource
      .getRepository(AccountSlotEntity)
      .findOne({ where: { id: slotId } });
    if (!slot?.accountId) throw new BadRequestException(`${await this.friendlySlotName(slotId)} 没有绑定账号`);

    // 'status@broadcast' 是 WA 协议约定 jid · Baileys 透传
    const sendResult = await sock.sendMessage('status@broadcast', { text });
    const waMessageId = sendResult?.key?.id ?? null;

    await this.persistMessage({
      accountId: slot.accountId,
      remoteJid: 'status@broadcast',
      direction: MessageDirection.Out,
      msgType: MessageType.Text,
      content: `[STATUS] ${text}`,
      sentAt: new Date(),
      waMessageId,
    });

    return { waMessageId };
  }

  /**
   * 发媒体 Status (M7 Day 1 #8 · 24h WA 动态 · image/video/voice).
   * M5 Phase 2+ 养号日历 + M7 素材库 casual_status 用.
   * jid = 'status@broadcast' · 消息载荷同 sendMedia 规则.
   * 不落盘媒体 (status 24h 过期 · 无审计价值) · 仅写 chat_message 行便于日历幂等.
   */
  async sendStatusMedia(
    slotId: number,
    type: 'image' | 'video' | 'voice' | 'file',
    contentBase64: string,
    options: { mimeType?: string; filename?: string; caption?: string } = {},
  ): Promise<{ waMessageId: string | null }> {
    const sock = this.pool.get(slotId);
    if (!sock) {
      throw new BadRequestException(
        `${await this.friendlySlotName(slotId)} 未在线 (pool 无 socket). 先完成扫码绑定 / 等 rehydrate 完成.`,
      );
    }
    const slot = await this.dataSource
      .getRepository(AccountSlotEntity)
      .findOne({ where: { id: slotId } });
    if (!slot?.accountId) throw new BadRequestException(`${await this.friendlySlotName(slotId)} 没有绑定账号`);

    const buffer = Buffer.from(contentBase64, 'base64');
    if (buffer.length === 0) throw new BadRequestException('contentBase64 解码后为空');
    if (buffer.length > 16 * 1024 * 1024) {
      throw new BadRequestException(`媒体大小超过 WA 16MB 上限 (${buffer.length} bytes)`);
    }

    let sendPayload: Parameters<WASocket['sendMessage']>[1];
    let msgTypeEnum: MessageType;
    switch (type) {
      case 'image':
        sendPayload = { image: buffer, caption: options.caption };
        msgTypeEnum = MessageType.Image;
        break;
      case 'video':
        sendPayload = {
          video: buffer,
          caption: options.caption,
          mimetype: options.mimeType ?? 'video/mp4',
        };
        msgTypeEnum = MessageType.Video;
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

    const sendResult = await sock.sendMessage('status@broadcast', sendPayload);
    const waMessageId = sendResult?.key?.id ?? null;

    await this.persistMessage({
      accountId: slot.accountId,
      remoteJid: 'status@broadcast',
      direction: MessageDirection.Out,
      msgType: msgTypeEnum,
      content: options.caption ? `[STATUS] ${options.caption}` : `[STATUS ${type}]`,
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

    // 2026-04-25 · baileys options 每 slot 独立随机化 (种子派生 · 重连不变)
    const opts = isolation.fingerprint.baileysOpts;
    const sock = makeWASocket({
      version: version as [number, number, number],
      auth: state,
      printQRInTerminal: false,
      logger: this.baileysLogger,
      // fingerprint.baileysBrowser = [model, 'Desktop', chromeMajor] — 每槽独立, 跨会话稳定
      browser: isolation.fingerprint.baileysBrowser,
      agent: (isolation.agent ?? undefined) as never,
      fetchAgent: (isolation.agent ?? undefined) as never,
      syncFullHistory: false,
      // 以下 5 项从 fingerprint.baileysOpts 派生 · 每 slot 不同
      connectTimeoutMs: opts.connectTimeoutMs,
      keepAliveIntervalMs: opts.keepAliveIntervalMs,
      defaultQueryTimeoutMs: opts.defaultQueryTimeoutMs,
      emitOwnEvents: opts.emitOwnEvents,
      markOnlineOnConnect: opts.markOnlineOnConnect,
    });
    ctx.sock = sock;

    // 2026-04-21: 包一层 try/catch · session 目录被外部删 (rm -rf data/slots) 会 ENOENT
    // 不让这种磁盘异常拖死整个 process (配合 main.ts 的 unhandledRejection 全局 handler 双保险)
    sock.ev.on('creds.update', async () => {
      try {
        await saveCreds();
      } catch (err: unknown) {
        const e = err as { code?: string; message?: string };
        if (e.code === 'ENOENT') {
          this.logger.warn(
            `slot saveCreds ENOENT · session dir missing · slot needs rebind. err=${e.message}`,
          );
        } else {
          this.logger.error(`saveCreds failed: ${e.message ?? String(err)}`);
        }
      }
    });

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
          // 2026-04-21 · 改友好 · 以前只暴露 account_id · 用户看不懂是谁占的
          // 查占用该号的槽位 + 租户名, 告诉用户具体位置
          const occupyingSlot = await manager
            .createQueryBuilder(AccountSlotEntity, 'slot')
            .leftJoinAndSelect('slot.tenant', 'tenant')
            .where('slot.accountId = :accId', { accId: existing.id })
            .getOne();
          const tenantName = occupyingSlot?.tenant?.name ?? '(无租户绑定)';
          const slotIndex = occupyingSlot?.slotIndex ?? '—';
          throw new Error(
            `手机号 ${phone} 已被租户「${tenantName}」的 #${slotIndex} 槽位占用。` +
              `请先在该租户处原厂重置该槽位, 或换一个手机号。`,
          );
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
      // 2026-04-22 · 初始化 lastOpenAt · 否则 backend 重启后 10 min smooth window 全部误判
      this.lastOpenAt.set(ctx.slotId, Date.now());

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
    // 2026-04-22 · 真正的根因 · 先踢旧 sock · 否则老新两个 sock 同时活 · 互相 440
    const oldSock = this.pool.get(slotId);
    if (oldSock) {
      this.logger.warn(`slot ${slotId} · spawnPool 前 pool 里还有老 sock · 先 end 掉`);
      try {
        oldSock.end(undefined);
      } catch {
        /* ignore */
      }
      this.pool.delete(slotId);
    }
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

    // 2026-04-25 · baileys options 每 slot 随机化 (rehydrate 路径)
    const opts = isolation.fingerprint.baileysOpts;
    const sock = makeWASocket({
      version: version as [number, number, number],
      auth: state,
      printQRInTerminal: false,
      logger: this.baileysLogger,
      browser: isolation.fingerprint.baileysBrowser,
      agent: (isolation.agent ?? undefined) as never,
      fetchAgent: (isolation.agent ?? undefined) as never,
      syncFullHistory: false,
      connectTimeoutMs: opts.connectTimeoutMs,
      keepAliveIntervalMs: opts.keepAliveIntervalMs,
      defaultQueryTimeoutMs: opts.defaultQueryTimeoutMs,
      emitOwnEvents: opts.emitOwnEvents,
      markOnlineOnConnect: opts.markOnlineOnConnect,
    });

    this.attachPoolListeners(slotId, slotIndex, slot.accountId, sock, saveCreds);
    this.pool.set(slotId, sock);
    // 2026-04-22 · 初始化 lastOpenAt (spawn 成功 · UI 10 min 宽容期)
    this.lastOpenAt.set(slotId, Date.now());
  }

  private attachPoolListeners(
    slotId: number,
    slotIndex: number,
    accountId: number,
    sock: WASocket,
    saveCreds: () => Promise<void>,
  ): void {
    // 2026-04-21: 包一层 try/catch · session 目录被外部删 (rm -rf data/slots) 会 ENOENT
    // 不让这种磁盘异常拖死整个 process (配合 main.ts 的 unhandledRejection 全局 handler 双保险)
    sock.ev.on('creds.update', async () => {
      try {
        await saveCreds();
      } catch (err: unknown) {
        const e = err as { code?: string; message?: string };
        if (e.code === 'ENOENT') {
          this.logger.warn(
            `slot saveCreds ENOENT · session dir missing · slot needs rebind. err=${e.message}`,
          );
        } else {
          this.logger.error(`saveCreds failed: ${e.message ?? String(err)}`);
        }
      }
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === 'open') {
        // 2026-04-22 · 记 open 时间 · UI 平滑
        this.lastOpenAt.set(slotId, Date.now());
        // 2026-04-22 · 10 秒稳定才算真 open · 避免 WA 瞬开秒断骗我们清零
        // 否则 attempts 永远回 0 · MAX 永远不触发 · 死循环
        const rs = this.reconnectState.get(slotId);
        if (rs) {
          if (rs.stableTimer) clearTimeout(rs.stableTimer);
          rs.stableTimer = setTimeout(() => {
            const cur = this.reconnectState.get(slotId);
            if (cur) {
              cur.attempts = 0;
              // 2026-04-25 · 10s 稳定 = 440 计数也归零 · 证明当前环境 OK
              cur.consecutive440 = 0;
              if (cur.timer) {
                clearTimeout(cur.timer);
                cur.timer = null;
              }
              cur.stableTimer = null;
            }
          }, 10_000);
        }
        // 连上就把 DB suspended → active (若需要)
        // 2026-04-25 · 稳定性: 只有在 suspended_until 已过期时才翻回 · 冷却期内不动
        void (async () => {
          try {
            const slot = await this.dataSource
              .getRepository(AccountSlotEntity)
              .findOne({ where: { id: slotId } });
            if (!slot) return;
            if (slot.status === AccountSlotStatus.Quarantine) {
              // quarantine 不自动恢复 · 除非人工 reactivate 清了
              return;
            }
            if (slot.status === AccountSlotStatus.Suspended) {
              const now = Date.now();
              if (slot.suspendedUntil && new Date(slot.suspendedUntil).getTime() > now) {
                this.logger.warn(
                  `slot ${slotId} · suspended 冷却未过 (until ${slot.suspendedUntil.toISOString()}) · 不翻回 active`,
                );
                return;
              }
              this.logger.log(`slot ${slotId} · 连接恢复 · suspended → active · 心跳即写`);
              await this.dataSource
                .getRepository(AccountSlotEntity)
                .update(slotId, {
                  status: AccountSlotStatus.Active,
                  suspendedUntil: null,
                  socketLastHeartbeatAt: new Date(),
                });
            } else {
              // 正常 open · 即写心跳
              await this.dataSource
                .getRepository(AccountSlotEntity)
                .update(slotId, { socketLastHeartbeatAt: new Date() });
            }
          } catch {
            /* ignore */
          }
        })();
      }
      if (connection === 'close') {
        const code =
          lastDisconnect?.error instanceof Boom
            ? (lastDisconnect.error as Boom).output.statusCode
            : 0;
        this.recordCloseCode(slotId, code);
        // 取消稳定计时器 (还没到 30s 就断了 · 计数不重置)
        const rs = this.reconnectState.get(slotId);
        if (rs?.stableTimer) {
          clearTimeout(rs.stableTimer);
          rs.stableTimer = null;
        }
        if (code === DisconnectReason.loggedOut) {
          this.logger.warn(`slot ${slotId} logged out remotely — removing from pool + marking suspended`);
          this.pool.delete(slotId);
          this.clearReconnect(slotId);
          void this.markSlotSuspended(slotId);
        } else if (code === DisconnectReason.connectionReplaced) {
          // 2026-04-25 · 440 · 累计 2 次直接 quarantine · 不再烧号
          this.pool.delete(slotId);
          const cur = this.reconnectState.get(slotId) ?? { attempts: 0, timer: null };
          cur.last440 = true;
          cur.consecutive440 = (cur.consecutive440 ?? 0) + 1;
          this.reconnectState.set(slotId, cur);
          if (cur.consecutive440 >= BaileysService.QUARANTINE_440_THRESHOLD) {
            this.logger.error(
              `slot ${slotId} · 连续 ${cur.consecutive440} 次 440 · 判死 quarantine · 需人工换号`,
            );
            this.clearReconnect(slotId);
            void this.markSlotQuarantined(slotId);
            return;
          }
          this.logger.warn(
            `slot ${slotId} · 440 第 ${cur.consecutive440} 次 · ≥ ${BaileysService.QUARANTINE_440_THRESHOLD} 将 quarantine`,
          );
          this.scheduleReconnect(slotId, accountId, code);
        } else {
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

    // 2026-04-22 · Status feed 缓存监听 · 给 status executor 用
    if (this.statusCache) {
      this.statusCache.registerStatusListener(
        accountId,
        sock.ev as unknown as { on: (evt: string, fn: (msg: unknown) => void) => void },
      );
    }
  }

  private async markSlotSuspended(slotId: number): Promise<void> {
    const slot = await this.dataSource
      .getRepository(AccountSlotEntity)
      .findOne({ where: { id: slotId } });
    // 2026-04-25 · 稳定性: 设 suspended_until 冷却期 · 其他路径这期间不翻回 active
    const cooldownUntil = new Date(Date.now() + BaileysService.SUSPEND_COOLDOWN_MS);
    await this.dataSource
      .getRepository(AccountSlotEntity)
      .update(slotId, {
        status: AccountSlotStatus.Suspended,
        suspendedUntil: cooldownUntil,
      });
    this.logger.warn(
      `slot ${slotId} · suspended · 冷却至 ${cooldownUntil.toISOString()}`,
    );
    // 2026-04-22 · Gap 2 · 广播事件 · Dispatcher 监听并中断跑中的任务
    if (this.eventBus && slot?.accountId) {
      try {
        this.eventBus.emit('slot.suspended', { slotId, accountId: slot.accountId });
      } catch {
        /* ignore */
      }
    }
  }

  // 2026-04-25 · 明确判死 · 连续 2 次 440 后调用
  // 与 suspended 的区别: quarantine 不会 periodic recovery · 不会自动重连 · 只能人工原厂重置
  private async markSlotQuarantined(slotId: number): Promise<void> {
    const slot = await this.dataSource
      .getRepository(AccountSlotEntity)
      .findOne({ where: { id: slotId } });
    await this.dataSource
      .getRepository(AccountSlotEntity)
      .update(slotId, {
        status: AccountSlotStatus.Quarantine,
        suspendedUntil: null, // quarantine 不需要 cooldown 因为不会自动恢复
      });
    this.logger.error(
      `slot ${slotId} · QUARANTINE · 号疑似被 WA 限制 · 请租户原厂重置换新号`,
    );
    if (this.eventBus && slot?.accountId) {
      try {
        this.eventBus.emit('slot.suspended', { slotId, accountId: slot.accountId });
        this.eventBus.emit('slot.quarantined', { slotId, accountId: slot.accountId });
      } catch {
        /* ignore */
      }
    }
  }

  // ═══ Phase 2 · Worker 事件桥 ═══════════════════════════════════════════
  // Worker 发 baileys.worker.* 事件 · 这里订阅并复用 Phase 1 持久化逻辑
  // 仅 WA_WORKER_MODE=true 时 worker 会发这些事件 · 关闭时 worker 也不存在 · 天然无竞态

  @OnEvent('baileys.worker.message-upsert')
  async onWorkerMessageUpsert(evt: MessageUpsertEvent): Promise<void> {
    const slot = await this.dataSource
      .getRepository(AccountSlotEntity)
      .findOne({ where: { id: evt.slotId } });
    if (!slot?.accountId) return;
    for (const rawMsg of evt.messages) {
      try {
        await this.persistIncomingMessage(
          slot.slotIndex,
          slot.accountId,
          rawMsg as WAMessage,
          evt.upsertType === 'notify',
        );
      } catch (err) {
        this.logger.error(`worker msg persist slot ${evt.slotId}: ${err}`);
      }
    }
  }

  @OnEvent('baileys.worker.connection-open')
  async onWorkerConnectionOpen(evt: ConnectionOpenEvent): Promise<void> {
    // 类似原 pool listener 的自愈逻辑 · 尊重 suspended_until 冷却
    try {
      const slot = await this.dataSource
        .getRepository(AccountSlotEntity)
        .findOne({ where: { id: evt.slotId } });
      if (!slot) return;
      if (slot.status === AccountSlotStatus.Quarantine) return;
      if (slot.status === AccountSlotStatus.Suspended) {
        const now = Date.now();
        if (slot.suspendedUntil && new Date(slot.suspendedUntil).getTime() > now) {
          this.logger.warn(
            `worker slot ${evt.slotId} · suspended 冷却未过 · 不翻回 active`,
          );
          return;
        }
        this.logger.log(`worker slot ${evt.slotId} · 连接恢复 · suspended → active`);
      }
      await this.dataSource
        .getRepository(AccountSlotEntity)
        .update(evt.slotId, {
          status: AccountSlotStatus.Active,
          suspendedUntil: null,
          socketLastHeartbeatAt: new Date(),
        });
    } catch (err) {
      this.logger.warn(`onWorkerConnectionOpen slot ${evt.slotId}: ${err}`);
    }
  }

  @OnEvent('baileys.worker.connection-close')
  async onWorkerConnectionClose(evt: ConnectionCloseEvent): Promise<void> {
    // 记 close code 到 lastCloseInfo · 给诊断/UI 用
    this.recordCloseCode(evt.slotId, evt.code);
    this.logger.warn(`worker slot ${evt.slotId} connection-close code=${evt.code} reason=${evt.reason}`);
    // 重连策略在 worker 自身 · 父进程不再 scheduleReconnect (worker 未来会加 auto-reconnect 逻辑)
    // 440 quarantine 也在 worker 侧决策 · 父通过 worker-error fatal=true 接到后做 markSlotQuarantined
    if (evt.code === DisconnectReason.loggedOut) {
      void this.markSlotSuspended(evt.slotId);
    }
  }

  // ── 自动重连 (W3.1) ────────────────────────────────────
  // 2026-04-25 · 稳定性: 指数退避 60 × 2^n × jitter(0.7-1.3) · 比线性更温和
  //   attempt=0 → ~60s · =1 → ~120s · =2 → ~240s · =3 → ~480s · =4 → ~960s
  // 5 次还连不上 → suspended (非 440) 或 quarantine (已在 close handler 处理)
  private scheduleReconnect(slotId: number, accountId: number, closeCode: number, maxOverride?: number): void {
    const rs = this.reconnectState.get(slotId) ?? { attempts: 0, timer: null };
    if (rs.timer) clearTimeout(rs.timer);

    const maxAttempts = maxOverride ?? BaileysService.MAX_RECONNECT_ATTEMPTS;
    if (rs.attempts >= maxAttempts) {
      this.logger.error(
        `slot ${slotId} reached max reconnect (${rs.attempts}/${maxAttempts}), suspending. Last code=${closeCode}`,
      );
      this.reconnectState.delete(slotId);
      void this.markSlotSuspended(slotId);
      return;
    }

    // 指数退避 + ±30% jitter · 防多 slot 同时断开时同步 retry 形成 pattern
    const baseMs = BaileysService.RECONNECT_BASE_MS * Math.pow(2, rs.attempts);
    const jitter = 0.7 + Math.random() * 0.6;
    const delayMs = Math.round(baseMs * jitter);
    rs.attempts += 1;
    this.logger.warn(
      `slot ${slotId} reconnect #${rs.attempts}/${maxAttempts} in ${Math.round(delayMs / 1000)}s (code=${closeCode}, 440 count=${rs.consecutive440 ?? 0})`,
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
      if (
        slot.status === AccountSlotStatus.Suspended ||
        slot.status === AccountSlotStatus.Empty ||
        slot.status === AccountSlotStatus.Quarantine
      ) {
        this.logger.log(`slot ${slotId} status=${slot.status}, abort reconnect`);
        this.clearReconnect(slotId);
        return;
      }
      // 2026-04-25 · suspended_until 冷却期内 · 也不重连
      if (slot.suspendedUntil && new Date(slot.suspendedUntil).getTime() > Date.now()) {
        this.logger.log(
          `slot ${slotId} 冷却中 (until ${slot.suspendedUntil.toISOString()}), abort reconnect`,
        );
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
  }): Promise<{ contactId: number; messageId: string }> {
    let contactId = 0;
    let messageId = '0';
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
      contactId = contact.id;

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
      const saved = await manager.save(msg);
      messageId = String(saved.id);
    });

    // M9 · 仅 inbound 消息从这里广播. Outbound 由 ChatsController 自行 emit (带 manual=true),
    // 避免 executor 发的 out 被误标成 "手动" (执行器 send_to -> sendText -> persistMessage
    // 走这条路径, 接管 UI 不应在非接管期间收到它们).
    if (this.eventBus && params.direction === MessageDirection.In) {
      try {
        this.eventBus.emit('takeover.message.in', {
          accountId: params.accountId,
          contactId,
          messageId,
          remoteJid: params.remoteJid,
          direction: params.direction,
          msgType: params.msgType,
          content: params.content,
          mediaPath: params.mediaPath ?? null,
          waMessageId: params.waMessageId,
          sentAt: params.sentAt.toISOString(),
          manual: false,
        });
      } catch (err) {
        this.logger.debug(`emit takeover.message.in failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    return { contactId, messageId };
  }

  private inferMsgType(msg: WAMessage): MessageType {
    const m = msg.message;
    if (!m) return MessageType.Other;
    if (m.conversation || m.extendedTextMessage) return MessageType.Text;
    if (m.imageMessage) return MessageType.Image;
    if (m.videoMessage) return MessageType.Video; // 2026-04-21 · enum 已加 Video
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

  /**
   * 2026-04-22 · 把内部 slotId (DB id) 转成租户友好的"槽位 #N · 手机号" 字符串
   * 用于错误信息 · 不要让租户看到 id=62 这种困惑数字
   */
  private async friendlySlotName(slotId: number): Promise<string> {
    try {
      const slot = await this.dataSource
        .getRepository(AccountSlotEntity)
        .findOne({ where: { id: slotId }, relations: ['account'] });
      if (!slot) return `槽位 (未知)`;
      const phone = slot.account?.phoneNumber ? ` · ${slot.account.phoneNumber}` : '';
      return `槽位 #${slot.slotIndex}${phone}`;
    } catch {
      return `槽位 (未知)`;
    }
  }

  /**
   * 2026-04-22 · UI 显示用的"平滑 online" 状态
   * - 当下在 pool · 立刻 true
   * - 或最近 10 分钟内有过 open 事件 · 也 true
   * 哲学: 440 断开/重连是 WA 协议正常行为 · 不该吓唬租户
   * 只有连 10 分钟都没 open 过 · 才算真"掉了"
   */
  isOnlineSmooth(slotId: number): boolean {
    if (this.pool.has(slotId)) return true;
    const lastOpen = this.lastOpenAt.get(slotId);
    if (!lastOpen) return false;
    return Date.now() - lastOpen < 600_000; // 10 min
  }

  /** 2026-04-22 · executor 拿 status 缓存 */
  getStatusCache(): StatusCacheService | null {
    return this.statusCache ?? null;
  }

  // 2026-04-22 · 记录每个 slot 最近一次 close code (供诊断用)
  private lastCloseInfo = new Map<number, { code: number; at: string; count440: number; countTimeout: number }>();
  // 2026-04-22 · 最近一次 connection=open 的时间 · 用于 UI 平滑 online 状态 (避免重连循环中 UI 跳)
  private lastOpenAt = new Map<number, number>();

  recordCloseCode(slotId: number, code: number): void {
    const prev = this.lastCloseInfo.get(slotId) ?? { code: 0, at: '', count440: 0, countTimeout: 0 };
    this.lastCloseInfo.set(slotId, {
      code,
      at: new Date().toISOString(),
      count440: prev.count440 + (code === 440 ? 1 : 0),
      countTimeout: prev.countTimeout + (code === 408 ? 1 : 0),
    });
  }

  /** 2026-04-22 · 手动重连 · 把 suspended 槽重新拉起来 */
  async reactivateAndRespawn(slotId: number): Promise<void> {
    const slot = await this.dataSource
      .getRepository(AccountSlotEntity)
      .findOne({ where: { id: slotId } });
    if (!slot) throw new Error(`slot ${slotId} 不存在`);
    if (!slot.accountId) throw new Error(`slot ${slotId} 未绑号`);
    // 2026-04-25 · quarantine 不允许自动 reactivate · 必须人工原厂重置换号
    if (slot.status === AccountSlotStatus.Quarantine) {
      throw new Error(
        `slot ${slotId} 已被 quarantine (疑似 WA 限制该号) · 请原厂重置后换新号重新绑定`,
      );
    }
    // 先踢掉 pool 里挂掉的旧 sock · 避免新旧 sock 冲突 (互相踢)
    await this.evictFromPool(slotId);
    // 状态回 active · 清冷却时间戳
    await this.dataSource
      .getRepository(AccountSlotEntity)
      .update(slotId, {
        status: AccountSlotStatus.Active,
        suspendedUntil: null,
      });
    // 清 reconnect 状态 · 给新一轮机会 (包括 440 计数)
    this.clearReconnect(slotId);
    // 清 close 历史
    this.lastCloseInfo.delete(slotId);
    // spawn 新 socket
    await this.spawnPooledSocket(slotId, slot.slotIndex);
    this.logger.log(`slot ${slotId} · 手动重连触发 · evict 旧 sock → spawn 新 sock`);
  }

  /** 2026-04-22 · 给前端诊断信息 · 说明为什么被封 + 怎么办 */
  getConnectionDiagnosis(
    slotId: number,
    slot: { status: string; phoneNumber: string | null; proxyId: number | null; simInfo?: { countryCode?: string | null } | null },
  ): {
    online: boolean;
    status: string;
    lastCloseCode: number | null;
    lastCloseAt: string | null;
    count440: number;
    countTimeout: number;
    issues: string[];
    suggestions: string[];
  } {
    const online = this.isInPool(slotId);
    const close = this.lastCloseInfo.get(slotId);
    const issues: string[] = [];
    const suggestions: string[] = [];

    // 1. 440 · 号在其他设备登录
    if (close && close.code === 440) {
      issues.push('🔴 号在其他设备活跃登录 · WA 把我们的连接踢掉 (close code 440)');
      suggestions.push('检查手机 WA 是否在用 · 或从手机 WA 主动"删除链接的设备"');
      suggestions.push('若 SIM 插在别的手机 · 关闭那部手机的 WA app');
    }

    // 2. 515 · restartRequired 很多次
    if (close && close.code === 515) {
      issues.push('🟡 连接反复要求重启 · 可能是代理/IP 频繁变化触发风控');
      suggestions.push('换个稳定的住宅 IP 代理');
    }

    // 3. 408 timeout · 网络问题
    if (close && close.countTimeout >= 2) {
      issues.push('🟡 连接反复超时 · 网络不稳 (close code 408)');
      suggestions.push('代理延迟过高 / 丢包 · 换更快的代理');
      suggestions.push('或改成直连测试 (临时)');
    }

    // 4. 国家不匹配 (号 vs 代理 vs SIM)
    const phoneCountry = this.guessCountryFromPhone(slot.phoneNumber);
    const simCountry = slot.simInfo?.countryCode?.toUpperCase();
    if (phoneCountry && simCountry && phoneCountry !== simCountry) {
      issues.push(`🟡 号码国家 (${phoneCountry}) 和 SIM 录入国家 (${simCountry}) 不一致`);
      suggestions.push('检查 SIM 信息录入是否正确');
    }

    if (issues.length === 0 && slot.status === 'suspended') {
      issues.push('⚠ 槽位被标记为 suspended · 但没有最近的断连记录');
      suggestions.push('可能是历史状态残留 · 点 "🔄 重连" 试一次');
    }

    if (issues.length === 0 && !online) {
      issues.push('⚪ 槽位未在线 · Baileys 连接池里没有对应 socket');
      suggestions.push('点 "🔄 重连" 触发新连接');
    }

    return {
      online,
      status: slot.status,
      lastCloseCode: close?.code ?? null,
      lastCloseAt: close?.at ?? null,
      count440: close?.count440 ?? 0,
      countTimeout: close?.countTimeout ?? 0,
      issues,
      suggestions,
    };
  }

  private guessCountryFromPhone(phone: string | null): string | null {
    if (!phone) return null;
    const digits = phone.replace(/\D+/g, '');
    if (digits.startsWith('60')) return 'MY';
    if (digits.startsWith('65')) return 'SG';
    if (digits.startsWith('62')) return 'ID';
    if (digits.startsWith('66')) return 'TH';
    if (digits.startsWith('84')) return 'VN';
    if (digits.startsWith('63')) return 'PH';
    if (digits.startsWith('44')) return 'GB';
    if (digits.startsWith('1')) return 'US';
    if (digits.startsWith('86')) return 'CN';
    if (digits.startsWith('91')) return 'IN';
    if (digits.startsWith('880')) return 'BD';
    if (digits.startsWith('971')) return 'AE';
    return null;
  }
}
