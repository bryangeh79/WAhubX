// 2026-04-25 · Phase 2 · 父进程 Orchestrator
//
// 职责:
//   - fork 子进程 (每 slot 一个 worker)
//   - 命令分发: send(slotId, cmd) 带 requestId · 返回 Promise<AckData>
//   - 事件路由: worker → parent → EventEmitter2 (给其他 service 订阅)
//   - 生命周期: worker exit auto-respawn · 24h 3 次崩则 quarantine
//   - 优雅关闭: onModuleDestroy 广播 shutdown · 等 ACK · 超时 SIGKILL
//
// 不做 (BaileysService 继续做):
//   - DB 持久化 (listeners 仍由 BaileysService 持有 · 订阅本 manager 的 EventEmitter2 事件)
//   - UI 状态汇总
//
// Feature flag: process.env.WA_WORKER_MODE = 'true' 启用 · 默认 false (保 Phase 1 行为)

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ChildProcess, fork } from 'node:child_process';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import { AccountSlotEntity, AccountSlotStatus } from '../../slots/account-slot.entity';
import { ProxyEntity } from '../../proxies/proxy.entity';
import { getWaSessionDir } from '../../../common/storage';
import { ensureFingerprint } from '../../../common/fingerprint';
import type {
  WorkerCommand,
  WorkerCommandAck,
  WorkerEvent,
  WorkerMessage,
  InitCommand,
} from './worker-protocol';
import {
  WORKER_IPC_TIMEOUT_MS,
  WORKER_RESPAWN_DELAY_MS,
  WORKER_MAX_RESPAWN_24H,
} from './worker-protocol';

export const WORKER_MODE_ENABLED = (): boolean =>
  process.env.WA_WORKER_MODE === 'true' || process.env.WA_WORKER_MODE === '1';

interface WorkerHandle {
  slotId: number;
  slotIndex: number;
  tenantId: number;
  child: ChildProcess;
  initialized: boolean;
  lastHeartbeatAt: number;
  respawnTimestamps: number[]; // 近 24h 崩溃时间戳 · 超 WORKER_MAX_RESPAWN_24H 则 quarantine
}

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

@Injectable()
export class BaileysWorkerManagerService implements OnModuleDestroy {
  private readonly logger = new Logger(BaileysWorkerManagerService.name);
  private readonly workers = new Map<number, WorkerHandle>();
  private readonly pending = new Map<string, PendingRequest>();
  private waVersion: [number, number, number] | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() private readonly eventBus?: EventEmitter2,
  ) {}

  // ═══ 公开 API ═══════════════════════════════════════════════════════

  /**
   * 为指定 slot fork 一个 worker · 若已存在则幂等返回
   * 完成后 worker 已完成 init · 可接命令
   */
  async spawnWorker(slotId: number): Promise<void> {
    if (!WORKER_MODE_ENABLED()) {
      throw new Error('WA_WORKER_MODE not enabled · refuse to spawn worker');
    }
    if (this.workers.has(slotId)) {
      this.logger.log(`worker for slot ${slotId} already running`);
      return;
    }

    const slot = await this.dataSource
      .getRepository(AccountSlotEntity)
      .findOne({ where: { id: slotId } });
    if (!slot) throw new Error(`slot ${slotId} 不存在`);
    // 允许 empty slot (accountId=null) · 因为 bind 流用 worker 做 QR handshake

    const initCmd = await this.buildInitCommand(slot);
    const handle = await this.forkAndInit(slot, initCmd);
    this.workers.set(slotId, handle);
  }

  /**
   * 发送文本 · 返回 { waMessageId, to }
   */
  async sendText(slotId: number, to: string, text: string): Promise<{ waMessageId: string | null; to: string }> {
    const ret = await this.sendCommand<{ waMessageId: string | null; to: string }>(slotId, {
      type: 'send-text',
      requestId: this.newReqId(),
      to,
      text,
    });
    return ret;
  }

  /**
   * 发送媒体 (image/video/voice/audio/file)
   */
  async sendMedia(
    slotId: number,
    to: string,
    mediaType: 'image' | 'video' | 'voice' | 'audio' | 'file',
    mediaBase64: string,
    options?: { mimetype?: string; caption?: string; ptt?: boolean; fileName?: string },
  ): Promise<{ waMessageId: string | null; to: string }> {
    return this.sendCommand(slotId, {
      type: 'send-media',
      requestId: this.newReqId(),
      to,
      mediaType,
      mediaBase64,
      mimetype: options?.mimetype,
      caption: options?.caption,
      ptt: options?.ptt,
      fileName: options?.fileName,
    });
  }

  /**
   * 发表情反应 · status@broadcast 或聊天 jid
   */
  async sendReact(
    slotId: number,
    to: string,
    key: { remoteJid: string; id: string; fromMe?: boolean; participant?: string },
    emoji: string,
  ): Promise<{ waMessageId: string | null }> {
    return this.sendCommand(slotId, {
      type: 'send-react',
      requestId: this.newReqId(),
      to,
      key,
      emoji,
    });
  }

  /**
   * 标已读 (status@broadcast view · 聊天已读等)
   */
  async readMessages(
    slotId: number,
    keys: Array<{ remoteJid: string; id: string; fromMe?: boolean; participant?: string }>,
  ): Promise<void> {
    await this.sendCommand(slotId, {
      type: 'read-messages',
      requestId: this.newReqId(),
      keys,
    });
  }

  /**
   * 接受群邀请
   */
  async groupAcceptInvite(slotId: number, inviteCode: string): Promise<{ groupJid: string }> {
    return this.sendCommand(slotId, {
      type: 'group-accept-invite',
      requestId: this.newReqId(),
      inviteCode,
    });
  }

  /**
   * 取头像 URL
   */
  async profilePictureUrl(slotId: number, jid: string, highRes = false): Promise<{ url: string | null }> {
    return this.sendCommand(slotId, {
      type: 'profile-picture-url',
      requestId: this.newReqId(),
      jid,
      highRes,
    });
  }

  /**
   * 改 About 签名
   */
  async updateProfileStatus(slotId: number, status: string): Promise<void> {
    await this.sendCommand(slotId, {
      type: 'update-profile-status',
      requestId: this.newReqId(),
      status,
    });
  }

  /**
   * 查频道 metadata (lookupBy='invite' 用 invite code · 'jid' 用频道 jid)
   */
  async newsletterMetadata(
    slotId: number,
    lookupBy: 'invite' | 'jid',
    key: string,
  ): Promise<unknown> {
    return this.sendCommand(slotId, {
      type: 'newsletter-metadata',
      requestId: this.newReqId(),
      lookupBy,
      key,
    });
  }

  /**
   * follow 频道
   */
  async newsletterFollow(slotId: number, jid: string): Promise<unknown> {
    return this.sendCommand(slotId, {
      type: 'newsletter-follow',
      requestId: this.newReqId(),
      jid,
    });
  }

  /**
   * 发 presence (composing / recording / paused / available / unavailable)
   */
  async sendPresence(
    slotId: number,
    to: string,
    presence: 'composing' | 'recording' | 'paused' | 'available' | 'unavailable',
  ): Promise<void> {
    await this.sendCommand(slotId, {
      type: 'send-presence',
      requestId: this.newReqId(),
      to,
      presence,
    });
  }

  /**
   * rehydrate · 已有 session 的 slot 重新起 socket
   */
  async rehydrate(slotId: number): Promise<void> {
    // spawnWorker 内部已 init · 再显式 rehydrate 创建 socket
    if (!this.hasWorker(slotId)) {
      await this.spawnWorker(slotId);
    }
    await this.sendCommand(slotId, {
      type: 'rehydrate',
      requestId: this.newReqId(),
    });
  }

  /**
   * 开始 bind 流 · QR 或 pair code
   * Worker 会通过 baileys.worker.qr / baileys.worker.pairing-code / baileys.worker.bind-state 事件汇报进度
   */
  async startBind(slotId: number, pairingPhoneNumber?: string): Promise<void> {
    if (!this.hasWorker(slotId)) {
      await this.spawnWorker(slotId);
    }
    await this.sendCommand(slotId, {
      type: 'start-bind',
      requestId: this.newReqId(),
      pairingPhoneNumber,
    });
  }

  /**
   * 取消 bind
   */
  async cancelBind(slotId: number): Promise<void> {
    if (!this.hasWorker(slotId)) return;
    await this.sendCommand(slotId, {
      type: 'cancel-bind',
      requestId: this.newReqId(),
    });
  }

  /**
   * 查 worker 的真实 socket 状态
   */
  async fetchStatus(slotId: number): Promise<{ initialized: boolean; wsOpen: boolean; userId: string | null }> {
    return this.sendCommand(slotId, {
      type: 'fetch-status',
      requestId: this.newReqId(),
    });
  }

  /**
   * 优雅关闭指定 slot 的 worker
   */
  async shutdownWorker(slotId: number): Promise<void> {
    const h = this.workers.get(slotId);
    if (!h) return;
    try {
      await this.sendCommand(slotId, { type: 'shutdown', requestId: this.newReqId() });
    } catch (err) {
      this.logger.warn(`worker ${slotId} shutdown ACK failed: ${err}`);
    }
    // 5s 内没自动 exit 则 SIGKILL
    await new Promise((r) => setTimeout(r, 5000));
    if (!h.child.killed) {
      h.child.kill('SIGKILL');
    }
    this.workers.delete(slotId);
  }

  hasWorker(slotId: number): boolean {
    return this.workers.has(slotId);
  }

  getHeartbeatAge(slotId: number): number | null {
    const h = this.workers.get(slotId);
    if (!h) return null;
    return Date.now() - h.lastHeartbeatAt;
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log(`shutting down ${this.workers.size} workers...`);
    const promises: Promise<void>[] = [];
    for (const slotId of this.workers.keys()) {
      promises.push(this.shutdownWorker(slotId).catch((e) => this.logger.warn(`worker ${slotId} shutdown: ${e}`)));
    }
    await Promise.all(promises);
  }

  // ═══ 内部 · fork + init 流程 ══════════════════════════════════════

  private async buildInitCommand(slot: AccountSlotEntity): Promise<InitCommand> {
    const fingerprint = ensureFingerprint({
      slotIndex: slot.slotIndex,
      tenantId: slot.tenantId,
    });
    let proxy: InitCommand['proxy'] = null;
    if (slot.proxyId !== null) {
      const p = await this.dataSource
        .getRepository(ProxyEntity)
        .findOne({ where: { id: slot.proxyId } });
      if (p) {
        proxy = {
          type: p.proxyType as 'http' | 'socks',
          host: p.host,
          port: p.port,
          username: p.username ?? undefined,
          password: p.password ?? undefined,
        };
      }
    }
    const version = await this.ensureWaVersion();
    return {
      type: 'init',
      requestId: this.newReqId(),
      slotId: slot.id,
      slotIndex: slot.slotIndex,
      tenantId: slot.tenantId,
      sessionDir: getWaSessionDir(slot.slotIndex),
      fingerprint: {
        baileysBrowser: fingerprint.baileysBrowser,
        baileysOpts: fingerprint.baileysOpts,
        userAgent: fingerprint.userAgent,
      },
      proxy,
      waVersion: version,
    };
  }

  private async forkAndInit(
    slot: AccountSlotEntity,
    initCmd: InitCommand,
  ): Promise<WorkerHandle> {
    // worker 文件路径: 编译后在 dist/modules/baileys/worker/baileys-worker.js
    // __dirname 在编译后是 dist/modules/baileys/worker/
    const workerPath = path.join(__dirname, 'baileys-worker.js');

    const child = fork(workerPath, [], {
      // 独立 stdio · 防子进程 log 污染父进程
      silent: false,
      // Node argv · 可以传 --inspect 调试
      execArgv: [],
    });

    const handle: WorkerHandle = {
      slotId: slot.id,
      slotIndex: slot.slotIndex,
      tenantId: slot.tenantId,
      child,
      initialized: false,
      lastHeartbeatAt: Date.now(),
      respawnTimestamps: [],
    };

    this.wireChildEvents(handle);

    // 发 init 命令 · 等 ACK
    const ackPromise = this.awaitAck(initCmd.requestId);
    child.send(initCmd);
    try {
      await ackPromise;
      handle.initialized = true;
      this.logger.log(`worker for slot ${slot.id} initialized · pid=${child.pid}`);
    } catch (err) {
      this.logger.error(`worker for slot ${slot.id} init failed: ${err}`);
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
      throw err;
    }
    return handle;
  }

  private wireChildEvents(handle: WorkerHandle): void {
    handle.child.on('message', (msg: unknown) => {
      const m = msg as WorkerMessage;
      if (!m || typeof m !== 'object' || !('kind' in m)) return;
      if (m.kind === 'ack') {
        this.handleAck(m);
      } else if (m.kind === 'event') {
        this.handleEvent(handle, m);
      }
    });

    handle.child.on('exit', (code, signal) => {
      this.logger.warn(`worker slot ${handle.slotId} exit code=${code} signal=${signal}`);
      this.workers.delete(handle.slotId);
      // 若非优雅退出 (code=0 表示 shutdown) 且 WORKER_MODE 仍启用 · 尝试 respawn
      if (code !== 0 && WORKER_MODE_ENABLED()) {
        void this.maybeRespawn(handle);
      }
    });

    handle.child.on('error', (err) => {
      this.logger.error(`worker slot ${handle.slotId} error: ${err.message}`);
    });
  }

  private async maybeRespawn(dead: WorkerHandle): Promise<void> {
    const now = Date.now();
    // 清 24h 外的崩溃记录
    dead.respawnTimestamps = dead.respawnTimestamps.filter((t) => now - t < 24 * 60 * 60 * 1000);
    dead.respawnTimestamps.push(now);
    if (dead.respawnTimestamps.length >= WORKER_MAX_RESPAWN_24H) {
      this.logger.error(
        `worker slot ${dead.slotId} 24h 内崩 ${dead.respawnTimestamps.length} 次 · 进入 quarantine · 不再 respawn`,
      );
      await this.dataSource
        .getRepository(AccountSlotEntity)
        .update(dead.slotId, { status: AccountSlotStatus.Quarantine });
      if (this.eventBus) {
        this.eventBus.emit('slot.quarantined', { slotId: dead.slotId });
      }
      return;
    }
    this.logger.warn(`worker slot ${dead.slotId} respawning in ${WORKER_RESPAWN_DELAY_MS / 1000}s...`);
    await new Promise((r) => setTimeout(r, WORKER_RESPAWN_DELAY_MS));
    try {
      await this.spawnWorker(dead.slotId);
    } catch (err) {
      this.logger.error(`respawn worker slot ${dead.slotId} failed: ${err}`);
    }
  }

  // ═══ ACK / 事件处理 ═══════════════════════════════════════════════

  private handleAck(ack: WorkerCommandAck): void {
    const p = this.pending.get(ack.requestId);
    if (!p) return; // 超时已 reject 或不归本 manager
    clearTimeout(p.timer);
    this.pending.delete(ack.requestId);
    if (ack.ok) p.resolve(ack.data);
    else p.reject(new Error(ack.error ?? 'worker command failed'));
  }

  private handleEvent(handle: WorkerHandle, evt: WorkerEvent): void {
    switch (evt.type) {
      case 'heartbeat':
        handle.lastHeartbeatAt = evt.ts;
        // 写心跳到 DB · 复用 Phase 1 的字段
        void this.dataSource
          .getRepository(AccountSlotEntity)
          .update(handle.slotId, { socketLastHeartbeatAt: new Date(evt.ts) })
          .catch(() => {
            /* ignore */
          });
        break;
      case 'worker-log':
        {
          const logEvt = evt as Extract<WorkerEvent, { type: 'worker-log' }>;
          const prefix = `[worker#${evt.slotId}]`;
          if (logEvt.level === 'error') this.logger.error(`${prefix} ${logEvt.message}`);
          else if (logEvt.level === 'warn') this.logger.warn(`${prefix} ${logEvt.message}`);
          else this.logger.log(`${prefix} ${logEvt.message}`);
        }
        break;
      case 'worker-error': {
        const errEvt = evt as Extract<WorkerEvent, { type: 'worker-error' }>;
        this.logger.error(
          `worker slot ${evt.slotId} error (fatal=${errEvt.fatal}): ${errEvt.error}`,
        );
        // 2026-04-25 · P0#1 · fatal worker-error · 父进程标 quarantine
        // 主因: worker 自管重连时连续 2 次 440 触发
        if (errEvt.fatal) {
          void this.dataSource
            .getRepository(AccountSlotEntity)
            .update(evt.slotId, { status: AccountSlotStatus.Quarantine })
            .then(() => {
              this.logger.error(
                `slot ${evt.slotId} · QUARANTINE · 由 worker fatal error 触发 · 需人工换号`,
              );
              if (this.eventBus) {
                const handle = this.workers.get(evt.slotId);
                this.eventBus.emit('slot.suspended', {
                  slotId: evt.slotId,
                  accountId: handle?.slotId, // accountId 父这边没存 · 用 slotId 占位 · dispatcher 自己查 DB
                });
                this.eventBus.emit('slot.quarantined', { slotId: evt.slotId });
              }
            })
            .catch((err) => {
              this.logger.warn(`update quarantine failed slot ${evt.slotId}: ${err}`);
            });
        }
        break;
      }
      case 'connection-open':
      case 'connection-close':
      case 'message-upsert':
      case 'creds-updated':
      case 'status-upsert':
      case 'qr':
      case 'pairing-code':
      case 'bind-state':
        // 转发到 EventEmitter2 · 现有 BaileysService 可订阅并 DB 持久化
        if (this.eventBus) {
          this.eventBus.emit(`baileys.worker.${evt.type}`, evt);
        }
        break;
      default:
        this.logger.warn(`unknown worker event type: ${(evt as WorkerEvent).type}`);
    }
  }

  // ═══ 工具 ═══════════════════════════════════════════════════════════

  private async sendCommand<T = unknown>(slotId: number, cmd: WorkerCommand): Promise<T> {
    const h = this.workers.get(slotId);
    if (!h) throw new Error(`no worker for slot ${slotId}`);
    if (!h.initialized && cmd.type !== 'init') {
      throw new Error(`worker slot ${slotId} not initialized`);
    }
    const p = this.awaitAck(cmd.requestId) as Promise<T>;
    h.child.send(cmd);
    return p;
  }

  private awaitAck(requestId: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`worker command ${requestId} timeout after ${WORKER_IPC_TIMEOUT_MS}ms`));
      }, WORKER_IPC_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, reject, timer });
    });
  }

  private newReqId(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  private async ensureWaVersion(): Promise<[number, number, number]> {
    if (this.waVersion) return this.waVersion;
    const { version } = await fetchLatestBaileysVersion();
    this.waVersion = version as [number, number, number];
    return this.waVersion;
  }
}
