import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { OnEvent } from '@nestjs/event-emitter';
import { AccountSlotEntity, AccountSlotStatus, AccountSlotRole } from './account-slot.entity';
import { WaAccountEntity } from './wa-account.entity';
import { TenantEntity } from '../tenants/tenant.entity';
import { ProxyEntity } from '../proxies/proxy.entity';
import type { SlotResponseDto } from './dto/slot-response.dto';
import { MessageDirection, MessageType } from '../messaging/chat-message.entity';
import { MessagingPersistenceService } from '../messaging/messaging-persistence.service';
import { SlotRuntimeRegistry } from '../slot-runtime/slot-runtime.registry';
import { RuntimeBridgeService } from '../runtime-bridge/runtime-bridge.service';
import { RuntimeProcessManagerService } from '../runtime-process/runtime-process-manager.service';
import { getSlotDir } from '../../common/storage';
import { ensureFingerprint } from '../../common/fingerprint';
import { writeProxyConf, type ProxyDescriptor } from '../../common/proxy-config';
import { getTelcoById, getCountry } from '../../data/telco-registry';

// 2026-04-21 · toResponse 需要的 per-account 聚合数据
interface AccountSideStats {
  warmupStartedAt: string | null;
  warmupCurrentDay: number;
  warmupPhase: number | null;
  tasksExecuted: number;
  contactsCount: number;
  channelsCount: number;
  groupsCount: number;
  simInfo: SlotSimInfoView | null;
}

// 2026-04-22 · 传给前端的 SIM 视图 (含新字段 + 合成的展示字符串)
export interface SlotSimInfoView {
  countryCode?: string | null;
  carrierId?: string | null;
  customCarrierName?: string | null;
  customCountryName?: string | null;
  iccidSuffix?: string | null;
  notes?: string | null;
  displayCarrier?: string | null;
  displayCountry?: string | null;
  // 旧字段 (向后兼容)
  iccid?: string | null;
  carrier?: string | null;
  country?: string | null;
}

@Injectable()
export class SlotsService {
  private readonly logger = new Logger(SlotsService.name);

  constructor(
    @InjectRepository(AccountSlotEntity)
    private readonly slotRepo: Repository<AccountSlotEntity>,
    @InjectRepository(WaAccountEntity)
    private readonly accountRepo: Repository<WaAccountEntity>,
    @InjectRepository(ProxyEntity)
    private readonly proxyRepo: Repository<ProxyEntity>,
    private readonly persistence: MessagingPersistenceService,
    private readonly dataSource: DataSource,
    // 2026-04-25 · D9-4 · 通过 Registry 选 runtime 实装 · 替 D8-3 直接 inject
    private readonly runtimes: SlotRuntimeRegistry,
    // 2026-04-25 · 测试冻结期 · connected 后调 fetch-account-info 拿真 phone
    private readonly runtimeBridge: RuntimeBridgeService,
    // 2026-04-26 · P0.10 · bringToFront 自愈需要 stop+respawn runtime
    private readonly runtimeProcess: RuntimeProcessManagerService,
  ) {}

  // 2026-04-25 · D9-4 · bind facade · 走 Registry · backend 不再到处写 if chromium / if baileys
  // (Codex 边界 6: 单一 runtime 协议来源 · bind/status/send 抽象层成立)
  // 2026-04-27 · D11.5 · per-slot 路由 · 客服号永远走 chromium

  async bindStartBind(slotId: number, pairingPhoneNumber?: string): Promise<unknown> {
    const slot = await this.slotRepo.findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException(`槽位 ${slotId} 不存在`);
    const r = await this.runtimes.runtimeFor(slot).startBind(slotId, pairingPhoneNumber);
    // 立即返当前 status (含 frontend 期待的字段) · 让 modal 拿首条 state
    const s = await this.bindGetStatus(slotId);
    return s ?? r;
  }

  async bindCancelBind(slotId: number): Promise<unknown> {
    const slot = await this.slotRepo.findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException(`槽位 ${slotId} 不存在`);
    await this.runtimes.runtimeFor(slot).cancelBind(slotId);
    return this.bindGetStatus(slotId);
  }

  // 2026-04-25 · 测试冻结期 · 修 D8-3 字段不对齐 bug (frontend BindExistingModal 期待老 baileys 形态)
  // 不动 ISlotRuntime 接口 · 在 facade 层投影 · D14 真收敛时再统一接口字段
  // 2026-04-27 · D11.5 · 改 async · 内部 fetch slot 拿 role
  async bindGetStatus(slotId: number): Promise<unknown> {
    const slot = await this.slotRepo.findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException(`槽位 ${slotId} 不存在`);
    const raw = this.runtimes.runtimeFor(slot).getBindStatus(slotId);
    // raw 可能 sync (chromium) 或 Promise (理论上 baileys 也 sync · 但接口允 Promise)
    if (raw && typeof (raw as { then?: unknown }).then === 'function') {
      // baileys/异步 实装路径 · 直接透传 (老 BaileysService.getStatus 已是 BindStatusView 形)
      return raw;
    }
    const status = raw as {
      online?: boolean;
      bindState?: string;
      qrDataUrl?: string | null;
      qrRefreshCount?: number;
      error?: string | null;
      sessionStartedAt?: number;
      connectedAt?: number;
      lastDisconnectCategory?: string | null;
      lastDisconnectReason?: string | null;
      // baileys 也可能有
      state?: string;
      qr?: string | null;
      pairingCode?: string | null;
      mode?: 'qr' | 'pairing-code';
      phoneNumber?: string | null;
      startedAt?: string;
      lastEventAt?: string;
    };
    // 投影到 frontend 期待的形态 (BindStatusView)
    // 优先 baileys 字段 (state/qr/etc) · 没就用 chromium 字段映射
    const nowIso = new Date().toISOString();
    const startedAt =
      status.startedAt ??
      (status.sessionStartedAt && status.sessionStartedAt > 0
        ? new Date(status.sessionStartedAt).toISOString()
        : nowIso);
    const lastEventAt =
      status.lastEventAt ??
      (status.connectedAt && status.connectedAt > 0
        ? new Date(status.connectedAt).toISOString()
        : startedAt);

    return {
      // frontend BindExistingModal 期待的字段 (baileys 老形态 · 必有)
      state: status.state ?? status.bindState ?? 'idle',
      qr: status.qr ?? status.qrDataUrl ?? null,
      pairingCode: status.pairingCode ?? null,
      mode: status.mode ?? 'qr',
      phoneNumber: status.phoneNumber ?? null,
      startedAt,
      lastEventAt,
      error: status.error ?? null,
      // 新增字段保留 (D14 收敛后会成主) · 不破坏老 frontend
      // 2026-04-27 · D11.5 · per-slot · 客服号永远 chromium
      runtime: this.runtimes.getRuntimeFor(slot),
      qrRefreshCount: status.qrRefreshCount ?? 0,
      online: status.online ?? false,
      lastDisconnectCategory: status.lastDisconnectCategory ?? null,
      lastDisconnectReason: status.lastDisconnectReason ?? null,
    };
  }

  // ═══ 2026-04-25 · 测试冻结期 · chromium bind connected → DB finalize ═══
  // 缺漏 (T2.1 暴露): runtime 报 bind-state=connected · 但 backend 没写 DB
  // baileys 路径走 creds.update 自动创号 · chromium 需在事件层手动
  // 流程:
  //   1. 收到 'runtime.bridge.bind-state' state=connected
  //   2. INSERT placeholder wa_account (phone=pending-<slotId>-<ts>) (D14 改读真号)
  //   3. UPDATE account_slot SET account_id, status=active, suspendedUntil=null
  //   4. log + 不报错
  @OnEvent('runtime.bridge.bind-state')
  async onChromiumBindStateChange(evt: { slotId: number; state: string }): Promise<void> {
    if (evt.state !== 'connected') return;
    try {
      const slot = await this.slotRepo.findOne({ where: { id: evt.slotId } });
      if (!slot) {
        this.logger.warn(`bind connected event · slot ${evt.slotId} 不存在 · 跳`);
        return;
      }
      // 2026-04-25 · 测试冻结期 · connected 后异步拉真 phone (fetch-account-info)
      // 给 page 一点时间 (chat-list 出现后 localStorage 可能还在写)
      const fetchRealPhone = async (): Promise<string | null> => {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const r = await this.runtimeBridge.sendCommand<{
            phone: string | null;
            source: string;
            rawWid?: string;
          }>(slot.id, { kind: 'cmd', type: 'fetch-account-info' });
          if (r?.phone) {
            this.logger.log(
              `slot ${slot.id} fetch-account-info · phone=${r.phone} source=${r.source} rawWid=${r.rawWid ?? 'n/a'}`,
            );
            return r.phone;
          }
          this.logger.warn(`slot ${slot.id} fetch-account-info · 未找到 phone (source=${r?.source})`);
          return null;
        } catch (err) {
          this.logger.warn(
            `slot ${slot.id} fetch-account-info 失败: ${err instanceof Error ? err.message : err}`,
          );
          return null;
        }
      };

      if (slot.accountId) {
        // 已有 account · rehydrate 路径 · 只确保 status=active
        if (slot.status !== AccountSlotStatus.Active && slot.status !== AccountSlotStatus.Warmup) {
          slot.status = AccountSlotStatus.Active;
          slot.suspendedUntil = null;
          await this.slotRepo.save(slot);
          this.logger.log(`slot ${slot.id} rehydrate connected · status → active`);
        }
        // 如果当前 account 是 placeholder phone · 也试着拉真 phone 替换
        const acc = await this.accountRepo.findOne({ where: { id: slot.accountId } });
        if (acc && acc.phoneNumber.startsWith('pending-')) {
          const realPhone = await fetchRealPhone();
          if (realPhone) {
            // 防 phone 冲突: 先查是否已存在
            const dup = await this.accountRepo.findOne({ where: { phoneNumber: realPhone } });
            if (dup && dup.id !== acc.id) {
              this.logger.warn(
                `slot ${slot.id} fetch-phone=${realPhone} 已绑 account ${dup.id} · 不替换 placeholder`,
              );
            } else {
              acc.phoneNumber = realPhone;
              await this.accountRepo.save(acc);
              this.logger.log(`slot ${slot.id} placeholder phone → ${realPhone} (account ${acc.id})`);
            }
          }
        }
        return;
      }
      // 首次 bind · 先创占位 account · 再异步替换真号
      const placeholderPhone = `pending-${slot.id}-${Date.now()}`;
      const account = await this.accountRepo.save(
        this.accountRepo.create({
          phoneNumber: placeholderPhone,
        }),
      );
      slot.accountId = account.id;
      slot.status = AccountSlotStatus.Active;
      slot.suspendedUntil = null;
      await this.slotRepo.save(slot);
      this.logger.log(
        `slot ${slot.id} · bind connected · account=${account.id} (placeholder phone) · 异步拉真号`,
      );

      // 异步拉真 phone · 不阻塞 listener
      void (async () => {
        const realPhone = await fetchRealPhone();
        if (realPhone) {
          const dup = await this.accountRepo.findOne({ where: { phoneNumber: realPhone } });
          if (dup && dup.id !== account.id) {
            this.logger.warn(
              `slot ${slot.id} fetch-phone=${realPhone} 已存在 account ${dup.id} · 改 slot 指向 dup · 删 placeholder`,
            );
            slot.accountId = dup.id;
            await this.slotRepo.save(slot);
            await this.accountRepo.delete(account.id);
          } else {
            account.phoneNumber = realPhone;
            await this.accountRepo.save(account);
            this.logger.log(`slot ${slot.id} placeholder → ${realPhone} (account ${account.id})`);
          }
        }
      })();
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : err, slotId: evt.slotId },
        `slot ${evt.slotId} · bind connected DB finalize 失败 · 不影响 runtime`,
      );
    }
  }

  // 2026-04-28 · auto-rehydrate · runtime ws 上线后, 已绑定号自动 startBind 进 chat-list
  // 设计:
  //   - runtime-process-manager auto-spawn 起 chromium → ws 连 backend → emit runtime-online
  //   - 此监听捕获该事件 · 看 slot.account_id 是否已绑 · 是 → 触发 startBind (rehydrate 路径)
  //   - 不绑 (account_id=null) → 跳, 等用户手动扫码
  //   - 配合 runtime-process-manager 全 active 号常驻 · slot 起来即用
  // 2026-04-28 · 客服号 24h online 自愈 (用户硬要求)
  //   触发: WA Web "Use here" 顶号 / chat-list 60s 不见 → emit connection-close category=wa-logged-out
  //   行为:
  //     - 客服号 (role=customer_service): 8s 后自动 startBind · IndexedDB 仍在则直接 rehydrate; 失效则进 qr 等扫码
  //     - 广告号 (broadcast): 不自动重连 · 避免触发 WA 风控 (短时间反复重连嫌疑)
  @OnEvent('runtime.bridge.connection-close')
  async onRuntimeConnectionClose(evt: {
    slotId: number;
    category: 'page-closed' | 'browser-disconnected' | 'wa-logged-out' | 'runtime-fatal';
    reason: string;
  }): Promise<void> {
    try {
      // wa-logged-out 才自愈 (其他类: 进程死了 · C1 auto-respawn 接管)
      if (evt.category !== 'wa-logged-out') return;
      const slot = await this.slotRepo.findOne({ where: { id: evt.slotId } });
      if (!slot) return;
      if (slot.role !== AccountSlotRole.CustomerService) {
        this.logger.log(
          `slot ${evt.slotId} (broadcast) wa-logged-out · 不自动重连 (避免触发 WA 风控) · 等手动`,
        );
        return;
      }
      if (!slot.accountId) {
        this.logger.log(`slot ${evt.slotId} (CS) wa-logged-out · 未绑账号 · 跳`);
        return;
      }
      this.logger.log(
        `slot ${evt.slotId} (CS) wa-logged-out · 8s 后自动 startBind 重连 · IndexedDB 在则直接 rehydrate`,
      );
      await new Promise((r) => setTimeout(r, 8_000));
      try {
        await this.runtimes.runtimeFor(slot).startBind(evt.slotId);
        this.logger.log(`slot ${evt.slotId} (CS) wa-logged-out · 自愈 startBind dispatched`);
      } catch (err) {
        this.logger.warn(
          `slot ${evt.slotId} (CS) wa-logged-out 自愈失败: ${err instanceof Error ? err.message : err} · 等下次 wa-logged-out 或 runtime crash 重启`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `slot ${evt.slotId} connection-close handler 异常: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  @OnEvent('runtime.bridge.runtime-online')
  async onRuntimeOnline(evt: { slotId: number; tenantId: number }): Promise<void> {
    try {
      const slot = await this.slotRepo.findOne({ where: { id: evt.slotId } });
      if (!slot) return;
      if (!slot.accountId) {
        this.logger.debug?.(
          `slot ${evt.slotId} runtime-online · 未绑账号 · 跳 auto-rehydrate · 等用户扫码`,
        );
        return;
      }
      // 给 ws + integrity-checks 落地 1s · 防 startBind 跟 init 抢资源
      await new Promise((r) => setTimeout(r, 1000));
      this.logger.log(
        `slot ${evt.slotId} runtime-online · account_id=${slot.accountId} · auto-rehydrate startBind`,
      );
      try {
        await this.runtimes.runtimeFor(slot).startBind(evt.slotId);
        this.logger.log(`slot ${evt.slotId} auto-rehydrate · startBind dispatched`);
      } catch (err) {
        // rehydrate 失败不致命 · 用户可手动 bringToFront 或重扫
        this.logger.warn(
          `slot ${evt.slotId} auto-rehydrate startBind 失败: ${err instanceof Error ? err.message : err}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `slot ${evt.slotId} runtime-online handler 异常: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // 2026-04-25 · 测试冻结期 · chromium 心跳 → DB heartbeat 列
  // 缺漏 (T2.1 暴露): UI "心跳已 Infinity 分钟无响应" · 因 socket_last_heartbeat_at=null
  // baileys 路径在 sock keepalive 写 · chromium 路径要在 backend 收到 heartbeat 事件时写
  @OnEvent('runtime.bridge.heartbeat')
  async onChromiumHeartbeat(evt: { slotId: number; ts: number }): Promise<void> {
    try {
      // 直接 UPDATE 不读 · 写次数 = slot 数 × 2/min · 量级低
      await this.slotRepo.update(
        { id: evt.slotId },
        { socketLastHeartbeatAt: new Date(evt.ts) },
      );
    } catch (err) {
      // 高频事件 · 错误降 debug 不污染 log
      this.logger.debug?.(
        `slot ${evt.slotId} heartbeat DB update failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // 2026-04-26 · P0.10 · 把 slot 对应 Chromium 窗口提前台 (人工接管入口)
  // 自愈: page session 关 (用户关了 chrome 窗口) · 自动 stop+respawn+rehydrate · 重试一次
  // 2026-04-27 · D11.5 · per-slot 路由 · 客服号永远 chromium · 不看全局 mode
  async bringToFront(slotId: number): Promise<{ broughtToFront: boolean; healed?: boolean }> {
    const slot = await this.slotRepo.findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException(`槽位 ${slotId} 不存在`);
    const mode = this.runtimes.getRuntimeFor(slot);
    if (mode !== 'chromium') {
      throw new BadRequestException(
        `bring-to-front 仅 chromium runtime 有意义 · 当前 slot ${slotId} (role=${slot.role}) 走 ${mode} · 客服号才走 chromium`,
      );
    }

    const tryOnce = async (): Promise<{ broughtToFront: boolean }> => {
      if (!this.runtimeBridge.hasConnection(slotId)) {
        throw new Error('runtime not connected');
      }
      const r = await this.runtimeBridge.sendCommand<{ broughtToFront: boolean }>(slotId, {
        kind: 'cmd',
        type: 'bring-to-front',
      });
      return { broughtToFront: r?.broughtToFront ?? false };
    };

    const isPageDeadError = (msg: string): boolean =>
      /session closed|page has been closed|Target closed|protocol error.*bring/i.test(msg);

    try {
      const r = await tryOnce();
      this.logger.log(`slot ${slotId} bring-to-front · result=${r.broughtToFront}`);
      return r;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!isPageDeadError(msg) && msg !== 'runtime not connected') {
        throw err;
      }
      this.logger.warn(
        `slot ${slotId} bringToFront · page session 已关 (or runtime offline) · 自动 stop+respawn+rehydrate (~30s)`,
      );

      // 1. stop 当前 runtime (kill chrome + node 进程)
      try {
        await this.runtimeProcess.stop(slotId);
      } catch (stopErr) {
        this.logger.debug?.(
          `slot ${slotId} stop 失败 (可能 process 已自然 exit): ${stopErr instanceof Error ? stopErr.message : stopErr}`,
        );
      }
      // 2. 等 1s 让 process 真退
      await new Promise((res) => setTimeout(res, 1500));

      // 3. 触发 rehydrate (内含 spawn + start-bind + waitForLogin)
      // ChromiumSlotRuntime.startBind 自带 ensureRuntimeOnline · 起新 runtime + 跑 runBindFlow
      // 2026-04-27 · D11.5 · 走 per-slot · slot 已 fetch 上文
      await this.runtimes.runtimeFor(slot).startBind(slotId);

      // 4. 等 bindState=connected (rehydrate complete) · poll bindStates cache 30s
      const start = Date.now();
      while (Date.now() - start < 30_000) {
        const cache = this.runtimeBridge.getCachedBindState(slotId);
        if (cache?.bindState === 'connected') break;
        await new Promise((res) => setTimeout(res, 500));
      }

      // 5. 重试 bringToFront
      const r = await tryOnce();
      this.logger.log(
        `slot ${slotId} bring-to-front · 自愈 respawn 后 · result=${r.broughtToFront}`,
      );
      return { ...r, healed: true };
    }
  }

  // ═══ 2026-04-25 · P0 集中补洞 · 发送 facade · 不再让 controller 直调 BaileysService ═══
  // 路由: SlotsService.sendText/sendMedia → SlotRuntimeRegistry.current() → Baileys/ChromiumSlotRuntime
  // 持久化: 任一 runtime 成功后都用 BaileysService.persistMessage (chat_message + contact upsert + emit takeover.message.in)

  /**
   * 发文本 · 路由到当前 runtime · 持久化 chat_message
   *
   * @throws BadRequestException slot 没绑账号 / runtime 未在线
   */
  // 2026-04-26 · Class A · 暴露 runtime mode 给 executor 做 chromium-only / baileys-only 决策
  // 2026-04-27 · D11.5 · executor 保留这个全局值用 (broadcast 决策仍用全局)
  //   客服号 executor 已不依赖此值 · slot 路由经 SlotsService 内部 facade · 已 per-slot
  getCurrentMode(): 'chromium' {
    return 'chromium';
  }

  // 2026-04-26 · Class A · 统一在线判定 facade
  // baileys mode: 看 pool / worker
  // chromium mode: 看 ws bridge + heartbeat (60s · 因为这条只用于"能不能立刻发" gate)
  // 任何 mode 下 pool 假阴性都不会误判 chromium slot 离线
  async isOnline(slotId: number): Promise<boolean> {
    const slot = await this.slotRepo.findOne({ where: { id: slotId } });
    if (!slot) return false;
    if (!this.runtimeBridge.hasConnection(slotId)) return false;
    const last = slot.socketLastHeartbeatAt;
    return !!last && Date.now() - last.getTime() < 90_000;
  }

  async sendText(
    slotId: number,
    to: string,
    text: string,
  ): Promise<{ waMessageId: string | null }> {
    const slot = await this.slotRepo.findOne({ where: { id: slotId } });
    if (!slot?.accountId) {
      throw new BadRequestException(`槽位 ${slotId} 没有绑定账号`);
    }
    // 2026-04-28 · Phase D · chromium-only · baileys 整体拔除
    const recipient = to.replace(/[^\d+]/g, '');
    if (!recipient) {
      throw new BadRequestException(`收件人 "${to}" 无效`);
    }

    const r = await this.runtimes.runtimeFor(slot).sendText(slotId, recipient, text);
    const waMessageId = r.messageId ?? null;
    this.logger.log(
      `slot ${slotId} chromium sendText to=${recipient} → messageId=${waMessageId}`,
    );

    const persistJid = `${recipient.replace(/[^\d]/g, '')}@s.whatsapp.net`;
    await this.persistence.persistMessage({
      accountId: slot.accountId,
      remoteJid: persistJid,
      direction: MessageDirection.Out,
      msgType: MessageType.Text,
      content: text,
      sentAt: new Date(),
      waMessageId,
    });
    return { waMessageId };
  }

  /**
   * 发媒体 · 路由到当前 runtime · 持久化 chat_message
   *
   * 当前 chromium runtime 仅支持 image / file (D10 范围 · video/voice 抛 not-supported)
   */
  // 2026-04-26 · Class A · 接 'video' 类型 (baileys 走 · chromium 拒)
  async sendMedia(
    slotId: number,
    to: string,
    type: 'image' | 'voice' | 'file' | 'video',
    contentBase64: string,
    options?: { mimeType?: string; filename?: string; caption?: string },
  ): Promise<{ waMessageId: string | null; mediaPath: string | null }> {
    const slot = await this.slotRepo.findOne({ where: { id: slotId } });
    if (!slot?.accountId) {
      throw new BadRequestException(`槽位 ${slotId} 没有绑定账号`);
    }
    // 2026-04-28 · Phase D · chromium-only · video/voice/audio 已 B1+B2 解锁
    const recipient = to.replace(/[^\d+]/g, '');
    if (!recipient) throw new BadRequestException(`收件人 "${to}" 无效`);

    const r = await this.runtimes.runtimeFor(slot).sendMedia(
      slotId,
      recipient,
      type,
      contentBase64,
      { caption: options?.caption, fileName: options?.filename },
    );
    const waMessageId = r.messageId ?? null;
    this.logger.log(
      `slot ${slotId} chromium sendMedia type=${type} to=${recipient} → messageId=${waMessageId}`,
    );

    const persistJid = `${recipient.replace(/[^\d]/g, '')}@s.whatsapp.net`;
    const msgType =
      type === 'image' ? MessageType.Image
      : type === 'video' ? MessageType.Video
      : type === 'voice' ? MessageType.Voice
      : MessageType.File;
    await this.persistence.persistMessage({
      accountId: slot.accountId,
      remoteJid: persistJid,
      direction: MessageDirection.Out,
      msgType,
      content: options?.caption ?? null,
      sentAt: new Date(),
      waMessageId,
    });
    return { waMessageId, mediaPath: null };
  }

  // ═══ 2026-04-26 · D11 · WA Status / Profile facade ════════════════
  // chromium 模式 → 走 ChromiumSlotRuntime → wa-web DOM cmd
  // baileys  模式 → 走 BaileysService 现有方法

  // 2026-04-27 · D11.5 · 5 个 status/profile facade · 全部走 per-slot 路由
  // 客服号 → chromium · 其他号 → baileys · 跟全局 env 不再相关

  /** 2026-04-28 · Phase D · chromium-only */
  async postStatusText(slotId: number, text: string): Promise<{ waMessageId: string | null }> {
    const slot = await this.slotRepo.findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException(`槽位 ${slotId} 不存在`);
    const rt = this.runtimes.runtimeFor(slot);
    if (!rt.postStatusText) throw new BadRequestException('runtime postStatusText 未实现');
    const r = await rt.postStatusText(slotId, text);
    return { waMessageId: r.messageId ?? null };
  }

  async postStatusMedia(
    slotId: number,
    mediaType: 'image' | 'video',
    mediaBase64: string,
    options?: { caption?: string; fileName?: string; mimeType?: string },
  ): Promise<{ waMessageId: string | null }> {
    const slot = await this.slotRepo.findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException(`槽位 ${slotId} 不存在`);
    const rt = this.runtimes.runtimeFor(slot);
    if (!rt.postStatusMedia) throw new BadRequestException('runtime postStatusMedia 未实现');
    const r = await rt.postStatusMedia(slotId, mediaType, mediaBase64, {
      caption: options?.caption,
      fileName: options?.fileName,
    });
    return { waMessageId: r.messageId ?? null };
  }

  async browseStatuses(
    slotId: number,
    options: { maxItems: number; dwellMs: number },
  ): Promise<{ viewed: number }> {
    const slot = await this.slotRepo.findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException(`槽位 ${slotId} 不存在`);
    const rt = this.runtimes.runtimeFor(slot);
    if (!rt.browseStatuses) throw new BadRequestException('runtime browseStatuses 未实现');
    return rt.browseStatuses(slotId, options);
  }

  async reactStatuses(
    slotId: number,
    options: { maxItems: number; emoji: string },
  ): Promise<{ reacted: number }> {
    const slot = await this.slotRepo.findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException(`槽位 ${slotId} 不存在`);
    const rt = this.runtimes.runtimeFor(slot);
    if (!rt.reactStatuses) throw new BadRequestException('runtime reactStatuses 未实现');
    return rt.reactStatuses(slotId, options);
  }

  async updateProfileAbout(slotId: number, text: string): Promise<void> {
    const slot = await this.slotRepo.findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException(`槽位 ${slotId} 不存在`);
    const rt = this.runtimes.runtimeFor(slot);
    if (!rt.updateProfileAbout) throw new BadRequestException('runtime updateProfileAbout 未实现');
    return rt.updateProfileAbout(slotId, text);
  }

  /**
   * P0.2 · Chromium runtime 推 message-upsert event · 进 backend 后写 chat_message
   *
   * Role gate (Codex D11-1 · 单一客服号):
   *   - customer_service: 持久化 + 触发 takeover.message.in (UI 卡片 / 自动回复链路)
   *   - broadcast: 不持久化, 仅 log (广告号收到回复就丢)
   *
   * payload 形态来自 runtime-chromium inbound-watcher · 是 IncomingMessageHint:
   *   { preview, phoneE164, lastMessagePreview, unreadCount, detectedAt, dedupeKey }
   *
   * 注意: hint 是 chat-list 预览 · 不是完整消息体. 没 phoneE164 时 = 不可对账 · 跳过.
   */
  @OnEvent('runtime.bridge.message-upsert')
  async onChromiumMessageUpsert(evt: {
    slotId: number;
    ts: number;
    messages: unknown[];
  }): Promise<void> {
    try {
      const slot = await this.slotRepo.findOne({ where: { id: evt.slotId } });
      if (!slot) return;
      if (!slot.accountId) {
        this.logger.debug?.(`message-upsert · slot ${evt.slotId} 无 account · 跳`);
        return;
      }
      // role gate
      // 2026-04-28 · Codex 执行单 三 · Option C 决策
      //   slot1 客服号: 完整 smart · 产品 KB + 通用 KB · 走完整 decider/executor
      //   slot2-6 广告号: 不跑产品 KB / 不跑复杂 AI / inbound silent (现状)
      //   理由:
      //     - 客服号 (P0 watcher/reader/decider) 都还在稳定中 · 广告号开放只会放大噪声
      //     - 广告号客户回复多是"在不在 / 不要发了" 等 · 转人工最稳
      //     - 等客服号稳定 · V2 再决定要不要给广告号开"低噪声兜底+handoff" 路径
      if (slot.role !== AccountSlotRole.CustomerService) {
        // broadcast 号 · 收到回复不入库 · 仅 log 留痕 (Option C 当前实施)
        this.logger.log(
          `slot ${evt.slotId} (broadcast/Option C silent) inbound 丢弃 · count=${evt.messages?.length ?? 0}`,
        );
        return;
      }

      for (const raw of evt.messages ?? []) {
        // 2026-04-26 · P0.11 · 高保真消息识别 (schemaVersion='p0.11-hifi')
        const hifi = raw as {
          schemaVersion?: string;
          waMessageId?: string;
          direction?: 'in' | 'out';
          text?: string;
          timestamp?: number;
          senderJid?: string;
          senderDisplay?: string;
        };
        if (hifi && hifi.schemaVersion === 'p0.11-hifi' && hifi.waMessageId) {
          // 高保真路径 · 真消息原文 + 真 jid + 真 messageId
          // 跳过 out (我方发的 · sendText/sendMedia 已在 outbound persist 路径写库)
          if (hifi.direction === 'out') {
            this.logger.debug?.(`slot ${evt.slotId} (CS) hifi inbound · direction=out · skip (outbound 路径已写库)`);
            continue;
          }
          // 2026-04-28 · Codex P0-4 · 提 phone 真号
          //   优先 senderJid (chat-reader 用 phoneHint 拼出来)
          //   退化 · 用 senderDisplay 数字 (老 fallback 老 reader 兼容)
          const jidMatch = (hifi.senderJid ?? '').match(/^(\d{8,15})@(c\.us|s\.whatsapp\.net|lid)$/);
          let phone: string | null = jidMatch ? jidMatch[1] : null;
          if (!phone && hifi.senderDisplay) {
            const m = hifi.senderDisplay.match(/(\d{8,15})/);
            if (m) phone = m[1];
          }
          if (!phone) {
            this.logger.warn(
              `slot ${evt.slotId} (CS) hifi inbound · senderJid+senderDisplay 都没抽到 phone · senderJid=${hifi.senderJid} senderDisplay="${hifi.senderDisplay}" · 跳`,
            );
            continue;
          }
          const remoteJid = `${phone}@s.whatsapp.net`; // 内部存 标准 jid
          // dedupe 用 wa_message_id (DB 现已有 wa_message_id 字段 · DB UNIQUE 约束兜底)
          // 但应用层先查 · 防止重复 INSERT 抛异常
          try {
            const existing = await this.dataSource
              .getRepository('chat_message' as never)
              .createQueryBuilder('m')
              .where('m.wa_message_id = :id', { id: hifi.waMessageId })
              .getCount();
            if (existing > 0) {
              this.logger.debug?.(
                `slot ${evt.slotId} (CS) hifi inbound · waMessageId=${hifi.waMessageId} · 已存在 · 跳`,
              );
              continue;
            }
          } catch {
            /* 查不到也继续 INSERT · DB unique 兜底 */
          }
          await this.persistence.persistMessage({
            accountId: slot.accountId,
            remoteJid,
            direction: MessageDirection.In,
            msgType: MessageType.Text,
            content: hifi.text ?? '',
            sentAt: new Date(hifi.timestamp ?? evt.ts ?? Date.now()),
            waMessageId: hifi.waMessageId,
            updateContactLastMessageAt: true,
            pushName: hifi.senderDisplay ?? undefined,
          });
          this.logger.log(
            `slot ${evt.slotId} (CS) P0.11 hifi inbound persist · phone=${phone} senderDisplay="${hifi.senderDisplay}" waMessageId=${hifi.waMessageId} text="${(hifi.text ?? '').slice(0, 40)}"`,
          );
          continue;
        }

        // 老 hint 路径 (chat-reader 失败时 fallback / 无 rowDataId 兼容)
        const hint = raw as {
          preview?: string;
          phoneE164?: string | null;
          lastMessagePreview?: string | null;
          unreadCount?: number;
          detectedAt?: number;
          identitySource?: 'phone' | 'jid-attr' | 'displayName' | 'unknown';
          displayName?: string | null;
        };
        if (!hint || typeof hint !== 'object') continue;

        // 2026-04-25 · B 路线 · 多身份兜底 (phone > displayName synthetic)
        // 不再因 phoneE164=null 直接跳 · 有 displayName 就构 synthetic JID 入库
        const phone = (hint.phoneE164 ?? '').replace(/[^\d]/g, '');
        let remoteJid: string;
        let identityLog: string;
        let identitySource: 'phone' | 'jid-attr' | 'displayName' | 'unknown' =
          hint.identitySource ?? 'unknown';

        if (phone) {
          // phone 有 (识别源 phone 或 jid-attr 都走这条 · WA 标准 JID)
          remoteJid = `${phone}@s.whatsapp.net`;
          identityLog = `phone=${phone}`;
          // 没显式 source 时按"有 phone"补 phone 标
          if (identitySource === 'unknown' || identitySource === 'displayName') {
            identitySource = 'phone';
          }
        } else if (hint.displayName) {
          // synthetic JID · 用 displayName slug · 防 contact 表 unique 冲突
          // 示例: "MTB Cas" → "synthetic-mtb-cas@local.synthetic"
          const slug = hint.displayName
            .toLowerCase()
            .replace(/[^a-z0-9一-龥]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 40) || 'unknown';
          remoteJid = `synthetic-${slug}@local.synthetic`;
          identityLog = `displayName="${hint.displayName}" jid=${remoteJid}`;
          identitySource = 'displayName';

          // 2026-04-28 · Codex P0-4 · synthetic dedupe
          //   防同一 WA 消息被 watcher 在两次 fire 里分别抓 real jid + synthetic
          //   规则: 5s 内同 account_id + content · 库里若已有 real jid (非 synthetic) 入库 · 跳本条
          const previewContent = hint.lastMessagePreview ?? hint.preview ?? '';
          if (previewContent) {
            try {
              const cnt = await this.dataSource
                .getRepository('chat_message' as never)
                .createQueryBuilder('m')
                .where('m.account_id = :acc', { acc: slot.accountId })
                .andWhere('m.direction = :dir', { dir: 'in' })
                .andWhere('m.content = :c', { c: previewContent })
                .andWhere('m.remote_jid NOT LIKE :synthetic', { synthetic: 'synthetic-%' })
                .andWhere('m.sent_at >= NOW() - INTERVAL \'5 seconds\'')
                .getCount();
              if (cnt > 0) {
                this.logger.log(
                  `slot ${evt.slotId} (CS) inbound synthetic skip · 5s 内已有 real jid 入同 content · jid=${remoteJid} content="${previewContent.slice(0, 40)}"`,
                );
                continue;
              }
            } catch {
              /* 查不到也继续走 · 不阻塞 */
            }
          }
        } else {
          // 全失败 · 真没 identity · 跳 (这种是 watcher 极端边界 · 应几乎不发生)
          this.logger.warn(
            `slot ${evt.slotId} inbound hint 既无 phone 也无 displayName · preview="${(hint.preview ?? '').slice(0, 40)}" · 跳`,
          );
          continue;
        }

        const content = hint.lastMessagePreview ?? hint.preview ?? '';
        const sentAt = new Date(hint.detectedAt ?? evt.ts ?? Date.now());

        await this.persistence.persistMessage({
          accountId: slot.accountId,
          remoteJid,
          direction: MessageDirection.In,
          msgType: MessageType.Text,
          content,
          sentAt,
          waMessageId: null,
          updateContactLastMessageAt: true,
          pushName: hint.displayName ?? undefined,
        });
        this.logger.log(
          `slot ${evt.slotId} (CS) inbound persist · source=${identitySource} ${identityLog} preview="${(content ?? '').slice(0, 40)}"`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `slot ${evt.slotId} message-upsert handler failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // ═══ 2026-04-25 · D11-1 · slot 角色管理 (Codex 锁定 5 边界) ═══════
  // 边界 1: 唯一 customer_service 必须 backend 硬约束 · 不靠 UI

  /**
   * 拉某 tenant 的客服号槽位 · 没设过则 null
   */
  async getCustomerServiceSlot(tenantId: number): Promise<AccountSlotEntity | null> {
    return this.slotRepo.findOne({
      where: { tenantId, role: AccountSlotRole.CustomerService },
    });
  }

  /**
   * 切换 slot 的 role · backend 硬校验
   *
   * 规则:
   *   broadcast → customer_service
   *     · 必须先确认该 tenant 没有别的 customer_service · 否则拒
   *     · partial unique index 也兜底 · 但 service 层先抛友好错
   *   customer_service → broadcast
   *     · 允许 · 但建议 UI 提示 "切完该 tenant 没客服号了"
   *
   * Codex 边界 1: backend 校验为主 · UI 校验为辅
   */
  async setRole(
    slotId: number,
    requesterTenantId: number | null,
    targetRole: AccountSlotRole,
  ): Promise<AccountSlotEntity> {
    const slot = await this.slotRepo.findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException(`槽位 ${slotId} 不存在`);

    // 租户隔离 (平台超管 tenantId=null 跳过)
    if (requesterTenantId !== null && slot.tenantId !== requesterTenantId) {
      throw new ForbiddenException(`槽位 ${slotId} 不属于当前租户`);
    }

    if (slot.role === targetRole) {
      // 没变 · 幂等返
      return slot;
    }

    if (targetRole === AccountSlotRole.CustomerService) {
      // 检查该 tenant 是否已有客服号
      const existing = await this.getCustomerServiceSlot(slot.tenantId);
      if (existing && existing.id !== slot.id) {
        // D11-2 (Codex 边界 ②): 用 ConflictException + 明确 code · 前端按 code 派发
        throw new ConflictException({
          code: 'CUSTOMER_SERVICE_EXISTS',
          message:
            `租户已有客服号 (槽位 #${existing.slotIndex}) · 每租户至多 1 个客服号 · ` +
            `请先把该槽位改回 broadcast`,
          existingSlotIndex: existing.slotIndex,
          existingSlotId: existing.id,
        });
      }
    }

    // 切 role
    slot.role = targetRole;
    await this.slotRepo.save(slot);
    this.logger.log(
      `slot ${slotId} role · ${slot.role} → ${targetRole} (tenant ${slot.tenantId})`,
    );
    return slot;
  }

  /**
   * 2026-04-21 · 一次性聚合多个 account 的 stats (防 N+1)
   * 给 listForTenant 用
   */
  private async loadStatsForAccounts(accountIds: number[]): Promise<Map<number, AccountSideStats>> {
    const result = new Map<number, AccountSideStats>();
    if (accountIds.length === 0) return result;

    const qr = this.dataSource;

    // warmup_plan
    const warmups: Array<{ account_id: number; started_at: Date; current_phase: number; current_day: number }> =
      await qr.query(
        `SELECT account_id, started_at, current_phase, current_day FROM warmup_plan WHERE account_id = ANY($1::int[])`,
        [accountIds],
      );

    // 2026-04-22 · "任务" 数改为 "实际参与的动作数"
    // 包含:
    //   - task_run.account_id 作为主 executor 的次数 (每 run 记 1)
    //   - chat_message.direction='out' 的发消息数 (作为 B 参与剧本也算)
    // 这样自动聊天的 B 号不会显 0
    const taskCounts: Array<{ account_id: number; cnt: string }> =
      await qr.query(
        `SELECT acc AS account_id, COUNT(*)::text AS cnt
         FROM (
           SELECT account_id AS acc FROM task_run WHERE account_id = ANY($1::int[])
           UNION ALL
           SELECT account_id AS acc FROM chat_message
           WHERE account_id = ANY($1::int[]) AND direction='out'
         ) x
         GROUP BY acc`,
        [accountIds],
      );

    // wa_contact · 按 JID 后缀分 · 个人 s.whatsapp.net / 群 @g.us / 频道 @newsletter
    const contactStats: Array<{ account_id: number; kind: string; cnt: string }> =
      await qr.query(
        `SELECT account_id,
           CASE
             WHEN remote_jid LIKE '%@g.us' THEN 'group'
             WHEN remote_jid LIKE '%@newsletter' THEN 'channel'
             ELSE 'contact'
           END AS kind,
           COUNT(*)::text AS cnt
         FROM wa_contact
         WHERE account_id = ANY($1::int[])
         GROUP BY account_id, kind`,
        [accountIds],
      );

    // sim_info (2026-04-22 · 扩字段 · 新 country_code/carrier_id/custom_*/iccid_suffix)
    const sims: Array<{
      account_id: number;
      carrier: string | null;
      registered_name: string | null;
      country_code: string | null;
      carrier_id: string | null;
      custom_carrier_name: string | null;
      custom_country_name: string | null;
      iccid_suffix: string | null;
      notes: string | null;
    }> = await qr.query(
      `SELECT account_id, carrier, registered_name, country_code, carrier_id,
              custom_carrier_name, custom_country_name, iccid_suffix, notes
         FROM sim_info WHERE account_id = ANY($1::int[])`,
      [accountIds],
    );

    // 组装
    const warmupMap = new Map(warmups.map((w) => [w.account_id, w]));
    const taskMap = new Map(taskCounts.map((t) => [t.account_id, parseInt(t.cnt, 10)]));
    const simMap = new Map(sims.map((s) => [s.account_id, s]));

    for (const id of accountIds) {
      const w = warmupMap.get(id);
      const sim = simMap.get(id);
      const stats: AccountSideStats = {
        warmupStartedAt: w?.started_at ? new Date(w.started_at).toISOString() : null,
        warmupCurrentDay: w?.current_day ?? 0,
        warmupPhase: w?.current_phase ?? null,
        tasksExecuted: taskMap.get(id) ?? 0,
        contactsCount: 0,
        channelsCount: 0,
        groupsCount: 0,
        simInfo: sim ? buildSimInfoView(sim) : null,
      };
      result.set(id, stats);
    }

    for (const c of contactStats) {
      const s = result.get(c.account_id);
      if (!s) continue;
      const n = parseInt(c.cnt, 10);
      if (c.kind === 'group') s.groupsCount = n;
      else if (c.kind === 'channel') s.channelsCount = n;
      else s.contactsCount = n;
    }

    return result;
  }

  // ── 初始化: 租户激活时调用, 预填 N 条 empty 槽位 ──────────────
  // 用 EntityManager 参数, 方便 license.activate() 在同一事务里复用
  async seedForTenant(manager: EntityManager, tenantId: number, slotLimit: number): Promise<void> {
    const existing = await manager.count(AccountSlotEntity, { where: { tenantId } });
    if (existing > 0) {
      this.logger.warn(`Tenant ${tenantId} already has ${existing} slots, skipping seed`);
      return;
    }

    // 读 tenant 的 timezone 给 fingerprint 用
    const tenant = await manager.findOne(TenantEntity, { where: { id: tenantId } });
    const tz = tenant?.timezone ?? 'Asia/Kuala_Lumpur';

    // D11-1 · 首槽 (slotIndex=1) = customer_service · 其余 broadcast (Codex 边界 1)
    const rows = Array.from({ length: slotLimit }, (_, i) =>
      manager.create(AccountSlotEntity, {
        tenantId,
        slotIndex: i + 1,
        accountId: null,
        status: AccountSlotStatus.Empty,
        proxyId: null,
        persona: null,
        profilePath: null,
        role: i === 0 ? AccountSlotRole.CustomerService : AccountSlotRole.Broadcast,
      }),
    );
    await manager.save(AccountSlotEntity, rows);

    // 技术交接文档 § 6: 槽位一建出来 data/slots/<N>/fingerprint.json 就存在
    // 稳定不漂移 (跨重连/重启保持), 不同 slot 落不同 model (DEVICE_POOL 抽)
    for (let i = 1; i <= slotLimit; i++) {
      ensureFingerprint({ slotIndex: i, tenantId, timezone: tz });
    }
    this.logger.log(`Seeded ${slotLimit} empty slots + fingerprints for tenant ${tenantId}`);
  }

  // 已存在的槽位 (活数据) 补 fingerprint — 用于升级后一次性回填, 幂等.
  // 既补 fingerprint.json 文件, 也把 JSON 内容写回 wa_account.device_fingerprint DB 列
  // (老版本 binding 时 DB 列为 null, 新版本 binding 会填).
  async backfillFingerprintsForTenant(tenantId: number): Promise<{ fsWritten: number; dbUpdated: number }> {
    const slots = await this.slotRepo.find({ where: { tenantId }, relations: ['account'] });
    const tenant = await this.slotRepo.manager.findOne(TenantEntity, { where: { id: tenantId } });
    const tz = tenant?.timezone ?? 'Asia/Kuala_Lumpur';
    let fsWritten = 0;
    let dbUpdated = 0;
    for (const s of slots) {
      const before = fs.existsSync(`${getSlotDir(s.slotIndex)}/fingerprint.json`);
      const fp = ensureFingerprint({ slotIndex: s.slotIndex, tenantId, timezone: tz });
      if (!before) fsWritten++;

      // 如果该槽位有绑定账号且 device_fingerprint 为空, 回填
      if (s.accountId && s.account && !s.account.deviceFingerprint) {
        const patch = { deviceFingerprint: fp as unknown } as Parameters<typeof this.accountRepo.update>[1];
        await this.accountRepo.update(s.accountId, patch);
        dbUpdated++;
      }
    }
    this.logger.log(`Backfill tenant=${tenantId}: fsWritten=${fsWritten}, dbUpdated=${dbUpdated}`);
    return { fsWritten, dbUpdated };
  }

  // ── 查询 (带 tenant 隔离) ────────────────────────────────────
  async listForTenant(tenantId: number): Promise<SlotResponseDto[]> {
    const slots = await this.slotRepo.find({
      where: { tenantId },
      relations: ['account'],
      order: { slotIndex: 'ASC' },
    });
    const accountIds = slots.map((s) => s.accountId).filter((x): x is number => x !== null);
    const statsMap = await this.loadStatsForAccounts(accountIds);
    return slots.map((s) => this.toResponse(s, s.accountId ? statsMap.get(s.accountId) : undefined));
  }

  async findOne(id: number, requesterTenantId: number | null): Promise<SlotResponseDto> {
    const slot = await this.slotRepo.findOne({
      where: { id },
      relations: ['account'],
    });
    if (!slot) throw new NotFoundException(`槽位 ${id} 不存在`);
    this.assertCanAccess(slot, requesterTenantId);
    const stats = slot.accountId
      ? (await this.loadStatsForAccounts([slot.accountId])).get(slot.accountId)
      : undefined;
    return this.toResponse(slot, stats);
  }

  // ── clear: 恢复出厂设置 · 完全清空 slot 所有痕迹 ────────────
  // 2026-04-28 · 系统级重写 · 用户高频用此功能 · 必须保证不残留任何状态
  // 13 步全清:
  //   1. RBAC 检查
  //   2. Tracked runtime 进程 graceful stop
  //   3. Process Manager handle 内存 purge (清 respawnTimer 等)
  //   4. Kill 任何 orphan chromium (按 user-data-dir 匹配 · 防上次 backend 残留)
  //   5. Force release takeover lock (写 DB takeover_active=false)
  //   6. 清 runtime-bridge bind state cache
  //   7. 删 wa_account (CASCADE → sim_info / account_health / wa_contact / chat_message)
  //   8. 重置 slot 所有 volatile 字段 (account_id / status / persona / profile_path /
  //      takeover_active / suspended_until / socket_last_heartbeat_at / role)
  //   9. rm -rf data/slots/<slotIndex>/  (老 baileys 残留)
  //   10. rm -rf %APPDATA%/wahubx/slots/<slotIndex>/  (chromium puppeteer profile)
  //   11. 保留: proxy_id (代理绑定独立于账号 · 租户期望保留)
  //   12. 保留: tenant_id (槽位归属不变)
  //   13. log 总结 + 返清空后 DTO
  async clear(id: number, requesterTenantId: number | null): Promise<SlotResponseDto> {
    const slot = await this.slotRepo.findOne({
      where: { id },
      relations: ['account'],
    });
    if (!slot) throw new NotFoundException(`槽位 ${id} 不存在`);
    this.assertCanAccess(slot, requesterTenantId);

    const idxPadded = String(slot.slotIndex).padStart(2, '0');
    const accountIdToDelete = slot.accountId;
    this.logger.log(
      `[clear] slot ${id} idx=${slot.slotIndex} acc=${accountIdToDelete} · 启动恢复出厂`,
    );

    // ── Step 2: tracked runtime graceful stop ────────────────
    try {
      await this.runtimeProcess.stop(id, { graceful: true, timeoutMs: 8_000 });
      this.logger.log(`[clear] slot ${id} · runtime stop OK`);
    } catch (err) {
      this.logger.warn(`[clear] slot ${id} · runtime stop 失败 (继续): ${err instanceof Error ? err.message : err}`);
    }

    // ── Step 3: process manager 内存 handle purge ────────────
    try {
      this.runtimeProcess.purgeSlot(id);
    } catch (err) {
      this.logger.warn(`[clear] slot ${id} · purgeSlot 失败 (继续): ${err}`);
    }

    // ── Step 4: 杀 orphan chromium (按 user-data-dir 匹配 · 上次 backend 残留)
    //   (best-effort · Windows 用 wmic 类似 · 这里用 Node 子进程 ps + kill)
    //   实现: 列所有 chrome.exe + grep CommandLine 含 wahubx/slots/<idx>
    //   失败不阻塞 · 老进程会自然死
    if (process.platform === 'win32') {
      try {
        const { execSync } = require('node:child_process') as typeof import('node:child_process');
        // 用 PowerShell 列 chrome.exe 命令行 · grep 匹配 slot · kill PID
        const psCmd = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*wahubx*slots*${idxPadded}*' } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }; Write-Host 'done'`;
        execSync(`powershell -NoProfile -Command "${psCmd.replace(/"/g, '\\"')}"`, {
          timeout: 8_000,
          windowsHide: true,
        });
        this.logger.log(`[clear] slot ${id} · orphan chromium killed (idx=${idxPadded})`);
      } catch (err) {
        this.logger.warn(`[clear] slot ${id} · orphan chromium kill 失败 (继续): ${err}`);
      }
    }

    // ── Step 5+8: 重置 slot 所有 volatile 字段 + force release takeover + DB ──
    slot.accountId = null;
    slot.account = null;
    slot.status = AccountSlotStatus.Empty;
    slot.persona = null;
    slot.profilePath = null;
    slot.takeoverActive = false; // force release lock (in-memory orphan无害)
    slot.suspendedUntil = null;
    slot.socketLastHeartbeatAt = null;
    // role 不重置 · 客服号 / 广告号属于槽位语义 · 跟账号无关
    await this.slotRepo.save(slot);

    // ── Step 6: 清 runtime-bridge bind state cache ────────────
    try {
      this.runtimeBridge.clearCachedBindState(id);
    } catch (err) {
      this.logger.warn(`[clear] slot ${id} · clear bind cache 失败 (继续): ${err}`);
    }

    // ── Step 7: 删 wa_account (CASCADE 带走子表) ─────────────
    if (accountIdToDelete) {
      try {
        await this.accountRepo.delete(accountIdToDelete);
        this.logger.log(`[clear] slot ${id} · wa_account ${accountIdToDelete} DELETE OK (cascade)`);
      } catch (err) {
        this.logger.warn(`[clear] slot ${id} · wa_account delete 失败 (DB 可能仍有残留): ${err}`);
      }
    }

    // ── Step 9: rm -rf data/slots/<slotIndex>/ (老 baileys 路径) ──
    const slotDir = getSlotDir(slot.slotIndex);
    try {
      if (fs.existsSync(slotDir)) {
        fs.rmSync(slotDir, { recursive: true, force: true });
        this.logger.log(`[clear] slot ${id} · ${slotDir} 已清`);
      }
    } catch (err) {
      this.logger.warn(`[clear] slot ${id} · 文件系统清理失败 (${slotDir}): ${err}`);
    }

    // ── Step 10: rm -rf chromium puppeteer profile ───────────
    //   Windows: %APPDATA%\wahubx\slots\<idx>\
    //   macOS: ~/Library/Application Support/wahubx/slots/<idx>/
    //   Linux: 跟 dataDir 同根 · Step 9 已清
    const chromiumSlotDir =
      process.platform === 'win32'
        ? path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'wahubx', 'slots', idxPadded)
        : process.platform === 'darwin'
          ? path.join(os.homedir(), 'Library', 'Application Support', 'wahubx', 'slots', idxPadded)
          : null;
    if (chromiumSlotDir) {
      try {
        if (fs.existsSync(chromiumSlotDir)) {
          fs.rmSync(chromiumSlotDir, { recursive: true, force: true });
          this.logger.log(`[clear] slot ${id} · chromium profile 已清: ${chromiumSlotDir}`);
        }
      } catch (err) {
        this.logger.warn(`[clear] slot ${id} · chromium profile 清理失败 (${chromiumSlotDir}): ${err}`);
      }
    }

    this.logger.log(
      `[clear] slot ${id} · 恢复出厂完成 · tenant=${slot.tenantId} idx=${slot.slotIndex}`,
    );
    return this.toResponse(slot);
  }

  // ── 绑代理 (M2 W3.5: 槽位级出口隔离) ──────────────────────────
  // proxyId=null 取消绑定 (dev 直连); 否则必须是本租户拥有的 proxy
  async assignProxy(id: number, requesterTenantId: number | null, proxyId: number | null): Promise<SlotResponseDto> {
    const slot = await this.slotRepo.findOne({ where: { id }, relations: ['account'] });
    if (!slot) throw new NotFoundException(`槽位 ${id} 不存在`);
    this.assertCanAccess(slot, requesterTenantId);

    if (proxyId !== null) {
      const proxy = await this.proxyRepo.findOne({ where: { id: proxyId } });
      if (!proxy) throw new NotFoundException(`代理 ${proxyId} 不存在`);
      if (requesterTenantId !== null && proxy.tenantId !== requesterTenantId) {
        throw new ForbiddenException('无权限使用该代理');
      }
      // 2026-04-28 · 代理切换 · 停 runtime 子进程 · 下次 spawn 走新代理
      try {
        await this.runtimeProcess.stop(slot.id, { graceful: true, timeoutMs: 5_000 });
      } catch { /* 没在跑就 ok */ }

      const desc: ProxyDescriptor = {
        type: proxy.proxyType as ProxyDescriptor['type'],
        host: proxy.host,
        port: proxy.port,
        username: proxy.username,
        password: proxy.password,
      };
      writeProxyConf(slot.slotIndex, desc);
    } else {
      writeProxyConf(slot.slotIndex, null);
      try {
        await this.runtimeProcess.stop(slot.id, { graceful: true, timeoutMs: 5_000 });
      } catch { /* 没在跑就 ok */ }
    }

    slot.proxyId = proxyId;
    await this.slotRepo.save(slot);
    this.logger.log(`slot ${id} proxy_id → ${proxyId}`);
    return this.toResponse(slot);
  }

  // ── 权限检查 ───────────────────────────────────────────────
  // 平台超管 (tenantId=null) 可访问任何; 租户用户只能访问自己租户
  private assertCanAccess(slot: AccountSlotEntity, requesterTenantId: number | null): void {
    if (requesterTenantId === null) return;
    if (slot.tenantId === requesterTenantId) return;
    throw new ForbiddenException('无权限访问该槽位');
  }

  private toResponse(slot: AccountSlotEntity, stats?: AccountSideStats): SlotResponseDto {
    const WARMUP_TOTAL_DAYS = 7; // 2026-04-22 · 从 14 改 7 (用户要求压缩方案)
    const currentDay = stats?.warmupCurrentDay ?? 0;
    const progressPct = Math.round((currentDay / WARMUP_TOTAL_DAYS) * 100);
    // 2026-04-22 · 实际 socket 是否在 pool · 用平滑版本 (60s 内开过就算 online)
    // 2026-04-25 · D12+ · Chromium 路径: bridge 有 WS 连接且 heartbeat < 90s → online
    //   (baileys 路径在 RUNTIME_MODE=chromium 时 pool 永远空 · 只看 baileys 会一直误报"正在同步连接")
    // 2026-04-28 · Phase D · chromium-only online 判定
    const bridgeConnected = this.runtimeBridge.hasConnection(slot.id);
    const heartbeatFresh =
      slot.socketLastHeartbeatAt &&
      Date.now() - slot.socketLastHeartbeatAt.getTime() < 90_000;
    const online = bridgeConnected && Boolean(heartbeatFresh);
    return {
      id: slot.id,
      tenantId: slot.tenantId,
      slotIndex: slot.slotIndex,
      status: slot.status,
      // 2026-04-25 · D11-1 · 角色字段返给前端 · 卡片画 role badge 用
      role: slot.role ?? AccountSlotRole.Broadcast,
      online,
      accountId: slot.accountId,
      phoneNumber: slot.account?.phoneNumber ?? null,
      waNickname: slot.account?.waNickname ?? null,
      warmupStage: slot.account?.warmupStage ?? null,
      proxyId: slot.proxyId,
      profilePath: slot.profilePath,
      createdAt: slot.createdAt,
      // 2026-04-25 · P1.6 · 前端按 runtime 模式决定哪些字段可信
      // 2026-04-27 · D11.5 · per-slot · 客服号永远 chromium · 其他号跟全局 env
      runtime: this.runtimes.getRuntimeFor(slot),
      // 2026-04-25 · 稳定性 · 真实状态三指标
      suspendedUntil: slot.suspendedUntil ? slot.suspendedUntil.toISOString() : null,
      socketLastHeartbeatAt: slot.socketLastHeartbeatAt
        ? slot.socketLastHeartbeatAt.toISOString()
        : null,
      // 2026-04-29 · P0-CS-3 · 状态灯真值 · UI 用此判断 chat-list/qr/splash/...
      //   注: 跟 online 区分 · online=WS 桥层面活着 · pageState=WA 业务真实状态
      pageState: this.runtimeBridge.getCurrentPageState(slot.id),
      // 2026-04-21 · 卡片信息增强
      warmupStartedAt: stats?.warmupStartedAt ?? null,
      warmupTotalDays: WARMUP_TOTAL_DAYS,
      warmupCurrentDay: currentDay,
      warmupProgressPct: Math.min(progressPct, 100),
      warmupPhase: stats?.warmupPhase ?? null,
      tasksExecuted: stats?.tasksExecuted ?? 0,
      contactsCount: stats?.contactsCount ?? 0,
      channelsCount: stats?.channelsCount ?? 0,
      groupsCount: stats?.groupsCount ?? 0,
      simInfo: stats?.simInfo ?? null,
    };
  }

  // ═══ 2026-04-28 · Phase D · 收编原 BaileysService 公开方法 ═══════════
  // 这些只查 DB / 控 runtime · 不依赖 baileys 协议

  async listContacts(accountId: number): Promise<unknown[]> {
    return this.dataSource.query(
      `SELECT id, account_id AS "accountId", remote_jid AS "remoteJid",
              display_name AS "displayName", is_internal AS "isInternal",
              added_at AS "addedAt", last_message_at AS "lastMessageAt"
         FROM wa_contact
        WHERE account_id = $1
        ORDER BY last_message_at DESC NULLS LAST`,
      [accountId],
    );
  }

  async listMessages(
    accountId: number,
    opts: { contactId?: number; limit?: number; beforeId?: string },
  ): Promise<unknown[]> {
    const conds: string[] = ['account_id = $1'];
    const params: unknown[] = [accountId];
    if (opts.contactId) {
      conds.push(`contact_id = $${params.length + 1}`);
      params.push(opts.contactId);
    }
    if (opts.beforeId) {
      conds.push(`id < $${params.length + 1}`);
      params.push(opts.beforeId);
    }
    const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
    return this.dataSource.query(
      `SELECT id, account_id AS "accountId", contact_id AS "contactId",
              direction, msg_type AS "msgType", content,
              media_path AS "mediaPath", sent_at AS "sentAt",
              wa_message_id AS "waMessageId", created_at AS "createdAt"
         FROM chat_message
        WHERE ${conds.join(' AND ')}
        ORDER BY id DESC
        LIMIT ${limit}`,
      params,
    );
  }

  /** 2026-04-28 · Phase D · 替代老 baileys.reactivateAndRespawn · 重启 chromium runtime 子进程 */
  async reactivateAndRespawn(slotId: number): Promise<void> {
    const slot = await this.slotRepo.findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException(`槽位 ${slotId} 不存在`);
    if (!slot.accountId) throw new BadRequestException(`槽位 ${slotId} 未绑号`);
    if (slot.status === AccountSlotStatus.Quarantine) {
      throw new BadRequestException(
        `槽位 ${slotId} 已被 quarantine (疑似 WA 限制) · 请原厂重置后换新号重新绑定`,
      );
    }
    try {
      await this.runtimeProcess.stop(slotId, { graceful: true, timeoutMs: 5_000 });
    } catch { /* 没在跑就忽略 */ }
    await this.slotRepo.update(slotId, {
      status: AccountSlotStatus.Active,
      suspendedUntil: null,
    });
    await this.runtimeProcess.start(slotId);
    this.logger.log(`slot ${slotId} 手动重连触发 · stop+start runtime`);
  }

  /** 2026-04-28 · Phase D · 简化诊断 · chromium-only */
  async getConnectionDiagnosis(
    slotId: number,
    slot: SlotResponseDto,
  ): Promise<{ kind: string; summary: string; advice: string }> {
    const bridgeConnected = this.runtimeBridge.hasConnection(slotId);
    if (slot.status === AccountSlotStatus.Quarantine) {
      return {
        kind: 'quarantine',
        summary: '该槽位被 quarantine · 疑似 WA 协议侧限制',
        advice: '原厂重置后换新号重绑',
      };
    }
    if (!bridgeConnected) {
      return {
        kind: 'offline',
        summary: 'runtime 子进程未连 WS 桥',
        advice: '点重连 · 或重启 backend · 仍不行查看后端日志 runtime spawn-failed',
      };
    }
    if (!slot.online) {
      return {
        kind: 'heartbeat-stale',
        summary: 'runtime 已连但 90s 内无 heartbeat',
        advice: '可能 chromium 已假死 · 点重连让它 respawn',
      };
    }
    return {
      kind: 'ok',
      summary: '在线 · runtime + heartbeat 正常',
      advice: '',
    };
  }

  /** 2026-04-28 · Phase D · 老 isInPool 的对应 · runtime 子进程是否在 */
  isInPool(slotId: number): boolean {
    return this.runtimeBridge.hasConnection(slotId);
  }
}

// 2026-04-22 · 从 DB 行 + telco-registry 合成前端用视图
function buildSimInfoView(sim: {
  carrier: string | null;
  country_code: string | null;
  carrier_id: string | null;
  custom_carrier_name: string | null;
  custom_country_name: string | null;
  iccid_suffix: string | null;
  notes: string | null;
}): SlotSimInfoView {
  let displayCarrier: string | null = null;
  let displayCountry: string | null = null;

  if (sim.carrier_id) {
    const hit = getTelcoById(sim.carrier_id);
    if (hit) {
      displayCarrier = hit.telco.brand
        ? `${hit.telco.name} (${hit.telco.brand})`
        : hit.telco.name;
    }
  }
  if (!displayCarrier && sim.custom_carrier_name) {
    displayCarrier = sim.custom_carrier_name;
  }
  if (!displayCarrier && sim.carrier) {
    // 向后兼容旧 free-text 字段
    displayCarrier = sim.carrier;
  }

  if (sim.country_code) {
    const c = getCountry(sim.country_code);
    if (c) displayCountry = `${c.flag} ${c.name}`;
  }
  if (!displayCountry && sim.custom_country_name) {
    displayCountry = sim.custom_country_name;
  }

  return {
    countryCode: sim.country_code,
    carrierId: sim.carrier_id,
    customCarrierName: sim.custom_carrier_name,
    customCountryName: sim.custom_country_name,
    iccidSuffix: sim.iccid_suffix,
    notes: sim.notes,
    displayCarrier,
    displayCountry,
    // 旧字段向后兼容
    iccid: sim.iccid_suffix,
    carrier: displayCarrier,
    country: sim.country_code,
  };
}
