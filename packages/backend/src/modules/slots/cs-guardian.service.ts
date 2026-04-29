// 2026-04-29 · P0.5-CS · 客服号守护 + post-login auto recovery
//
// 职责:
//   1. 监听 'runtime.bridge.page-state-changed' 事件 · pageState qr/splash → chat-list 时自动跑
//      post-login-recovery RPC (重装 watcher + rescan inbound)
//      仅对 customer_service 角色 slot 生效 (广告号本轮不动)
//      每个 slot debounce 60s · 防反复触发
//   2. 定时巡检 (每 CS_GUARDIAN_INTERVAL_SEC, 默认 180s)
//      只对 customer_service slot 跑 runCheckup + 必要时轻量自愈
//      规则:
//        healthy → 不动
//        runtime dead → start
//        runtime stale → stop+start (fallback)
//        chat-list + watcher unhealthy → reinstall-watcher RPC (轻量)
//        QR / loggedOut → 不修 · 写 audit · 让 UI 显告警条
//
// 不动 (Do Not Touch):
//   - sendText / session/profile/cookie / 8s aggregation / takeover lock 核心
//   - 广告号: 不巡检 · 不自动恢复 · 也不批量重启
//
// env:
//   CS_GUARDIAN_ENABLED=true  (默认 true)
//   CS_GUARDIAN_INTERVAL_SEC=180  (默认 180s · 范围 60-1800)

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountSlotEntity, AccountSlotRole, AccountSlotStatus } from './account-slot.entity';
import { RuntimeBridgeService } from '../runtime-bridge/runtime-bridge.service';
import { RuntimeProcessManagerService } from '../runtime-process/runtime-process-manager.service';
import { SlotHealthService } from './slot-health.service';
import { RecoveryAuditEntity } from './recovery-audit.entity';

const POST_LOGIN_DEBOUNCE_MS = 60_000;

interface PageStateChangedPayload {
  slotId: number;
  tenantId: number;
  oldPageState: string | null;
  newPageState: string;
  ts: number;
}

@Injectable()
export class CsGuardianService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CsGuardianService.name);
  private guardianTimer: NodeJS.Timeout | null = null;
  private lastPostLoginRecoveryAt = new Map<number, number>(); // slotId → ts
  private guardianTickRunning = false;

  constructor(
    private readonly config: ConfigService,
    private readonly runtimeBridge: RuntimeBridgeService,
    private readonly runtimeProcess: RuntimeProcessManagerService,
    private readonly slotHealth: SlotHealthService,
    @InjectRepository(AccountSlotEntity)
    private readonly slotRepo: Repository<AccountSlotEntity>,
    @InjectRepository(RecoveryAuditEntity)
    private readonly auditRepo: Repository<RecoveryAuditEntity>,
  ) {}

  onModuleInit(): void {
    const enabled = this.envBool('CS_GUARDIAN_ENABLED', true);
    if (!enabled) {
      this.logger.log('CS guardian DISABLED via env (CS_GUARDIAN_ENABLED=false)');
      return;
    }
    const intervalSec = Math.min(
      Math.max(this.envNum('CS_GUARDIAN_INTERVAL_SEC', 180), 60),
      1800,
    );
    this.logger.log(`CS guardian STARTED · interval=${intervalSec}s`);
    this.guardianTimer = setInterval(() => {
      void this.guardianTick();
    }, intervalSec * 1000);
    // 立即跑一次 (但延迟 30s 让 backend 完全起来)
    setTimeout(() => void this.guardianTick(), 30_000);
  }

  onModuleDestroy(): void {
    if (this.guardianTimer) {
      clearInterval(this.guardianTimer);
      this.guardianTimer = null;
    }
    this.lastPostLoginRecoveryAt.clear();
  }

  // ════════════════════════════════════════════════════════════════
  // Part 3 · post-login auto recovery
  //   pageState transition (qr/splash/connecting → chat-list) 时触发
  // ════════════════════════════════════════════════════════════════
  @OnEvent('runtime.bridge.page-state-changed')
  async onPageStateChanged(evt: PageStateChangedPayload): Promise<void> {
    try {
      // 仅 chat-list transition 触发 · 其他状态变化不动
      if (evt.newPageState !== 'chat-list') return;

      // 仅从这些状态进 chat-list 算"刚扫码/刚恢复"
      const RECOVERY_TRIGGER_STATES = ['qr', 'splash', 'splash-stuck', 'connecting', 'starting', 'closed', 'failed', null];
      if (!RECOVERY_TRIGGER_STATES.includes(evt.oldPageState)) return;

      // 仅对 customer_service 角色 slot 生效
      const slot = await this.slotRepo.findOne({ where: { id: evt.slotId } });
      if (!slot || slot.role !== AccountSlotRole.CustomerService) return;

      // debounce 60s · 防反复触发
      const lastAt = this.lastPostLoginRecoveryAt.get(evt.slotId) ?? 0;
      const now = Date.now();
      if (now - lastAt < POST_LOGIN_DEBOUNCE_MS) {
        this.logger.debug?.(
          `post-login-recovery skipped · slot ${evt.slotId} · debounce ${Math.round((now - lastAt) / 1000)}s ago`,
        );
        return;
      }
      this.lastPostLoginRecoveryAt.set(evt.slotId, now);

      this.logger.log(
        `post-login-recovery 触发 · slot ${evt.slotId} · ${evt.oldPageState} → chat-list`,
      );

      // 调 RPC (settle 3s 让 chat-list 稳定)
      const result = await this.runtimeBridge.postLoginRecovery(evt.slotId, 3000);

      // 写 recovery_audit
      try {
        await this.auditRepo.save(this.auditRepo.create({
          tenantId: evt.tenantId,
          slotId: evt.slotId,
          accountId: slot.accountId ?? null,
          actionType: 'recover',
          result: (result.ok && result.data?.ok) ? 'success' : 'partial',
          needScan: false,
          beforeSnapshot: { trigger: 'page-state-changed', oldPageState: evt.oldPageState, newPageState: evt.newPageState } as Record<string, unknown>,
          afterSnapshot: result.data as unknown as Record<string, unknown>,
          actionsAttempted: [{
            key: 'post_login_recovery_auto',
            status: (result.ok && result.data?.ok) ? 'pass' : 'warn',
            messageZh: `自动 post-login-recovery (chat-list 恢复后): ${result.data?.result ?? result.error ?? 'unknown'}`,
          }] as unknown as Array<Record<string, unknown>>,
          actionsSkipped: null,
          operatorUserId: null,
        }));
      } catch (err) {
        this.logger.warn(`post-login auto audit write failed: ${err instanceof Error ? err.message : err}`);
      }

      this.logger.log(
        `post-login-recovery slot ${evt.slotId} 完成 · result=${result.data?.result ?? '?'} · ok=${result.ok && result.data?.ok}`,
      );
    } catch (err) {
      // 不循环重试 · 只记录 · 等下次 guardian 巡检
      this.logger.warn(
        `post-login-recovery slot ${evt.slotId} 异常 (不重试 · 等下次巡检): ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Part 4 · 客服号自动巡检 (每 180s)
  // ════════════════════════════════════════════════════════════════
  private async guardianTick(): Promise<void> {
    if (this.guardianTickRunning) return;
    this.guardianTickRunning = true;
    try {
      // 拉所有 customer_service slot · status=active
      const csSlots = await this.slotRepo.find({
        where: { role: AccountSlotRole.CustomerService, status: AccountSlotStatus.Active },
      });
      if (csSlots.length === 0) {
        this.logger.debug?.('CS guardian tick · no active customer_service slot');
        return;
      }
      this.logger.debug?.(`CS guardian tick · checking ${csSlots.length} CS slot(s)`);

      for (const slot of csSlots) {
        try {
          await this.guardianCheckOne(slot);
        } catch (err) {
          this.logger.warn(
            `CS guardian slot ${slot.id} check failed: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
    } finally {
      this.guardianTickRunning = false;
    }
  }

  private async guardianCheckOne(slot: AccountSlotEntity): Promise<void> {
    const slotId = slot.id;
    const tenantId = slot.tenantId;
    if (!slot.accountId) return; // 没绑号不检

    // 跑 checkup (不写 audit · 我们自己决定是否需要写)
    const checkup = await this.slotHealth.runCheckup(slotId, tenantId, { writeAudit: false });

    if (checkup.overallStatus === 'healthy') {
      this.logger.debug?.(`CS guardian slot ${slotId} healthy · no action`);
      return;
    }

    const procCheck = checkup.checks.find((c) => c.key === 'runtime_process');
    const hbCheck = checkup.checks.find((c) => c.key === 'heartbeat_fresh');
    const waCheck = checkup.checks.find((c) => c.key === 'wa_state');
    const watcherCheck = checkup.checks.find((c) => c.key === 'watcher_installed');

    const procDead = procCheck?.status === 'fail';
    const hbStale = hbCheck?.status === 'fail';
    const waIsQr = waCheck?.value === 'qr';
    const waIsChatList = waCheck?.value === 'chat-list';
    const watcherUnhealthy = watcherCheck?.status !== 'pass';

    let action: string | null = null;
    let actionResult: 'pass' | 'warn' | 'fail' = 'pass';
    let messageZh = '';

    if (procDead) {
      action = 'runtime_start';
      try {
        await this.runtimeProcess.start(slotId);
        messageZh = `CS guardian: 客服号 runtime 已启动`;
      } catch (err) {
        actionResult = 'fail';
        messageZh = `CS guardian: runtime 启动失败 ${err instanceof Error ? err.message : err}`;
      }
    } else if (hbStale) {
      action = 'runtime_restart';
      try {
        await this.runtimeProcess.stop(slotId, { graceful: true, timeoutMs: 10_000 });
        await new Promise((r) => setTimeout(r, 1000));
        await this.runtimeProcess.start(slotId);
        messageZh = `CS guardian: runtime 假死 · 已重启 (fallback)`;
      } catch (err) {
        actionResult = 'fail';
        messageZh = `CS guardian: runtime 重启失败 ${err instanceof Error ? err.message : err}`;
      }
    } else if (waIsChatList && watcherUnhealthy) {
      action = 'reinstall_watcher_rpc';
      const r = await this.runtimeBridge.reinstallWatcher(slotId, true);
      actionResult = r.ok && r.data?.ok ? 'pass' : 'warn';
      messageZh = r.ok && r.data?.ok ? 'CS guardian: watcher 已重装 (RPC)' : `CS guardian: watcher 重装失败 ${r.error ?? '?'}`;
    } else if (waIsQr) {
      // 不修 · 写 audit 让 UI 显告警
      action = 'qr_alert';
      actionResult = 'warn';
      messageZh = 'CS guardian: 客服号在 QR · 需扫码 · UI 应显告警';
    } else {
      // 其他状态 (splash/connecting/closed) · 不动
      this.logger.debug?.(`CS guardian slot ${slotId} state=${waCheck?.value} · no action`);
      return;
    }

    // 写 audit
    try {
      await this.auditRepo.save(this.auditRepo.create({
        tenantId,
        slotId,
        accountId: slot.accountId,
        actionType: 'recover',
        result: actionResult === 'pass' ? 'success' : actionResult === 'warn' ? 'partial' : 'failed',
        needScan: waIsQr,
        beforeSnapshot: { trigger: 'cs-guardian-tick', overallStatus: checkup.overallStatus } as Record<string, unknown>,
        afterSnapshot: checkup as unknown as Record<string, unknown>,
        actionsAttempted: action ? [{ key: action, status: actionResult, messageZh }] as unknown as Array<Record<string, unknown>> : null,
        actionsSkipped: null,
        operatorUserId: null,
      }));
    } catch (err) {
      this.logger.warn(`CS guardian audit write failed: ${err instanceof Error ? err.message : err}`);
    }

    this.logger.log(`CS guardian slot ${slotId} action=${action} result=${actionResult} · ${messageZh}`);
  }

  // ─── 工具 ────
  private envBool(key: string, defaultValue: boolean): boolean {
    const v = this.config.get<string>(key);
    if (v == null || v === '') return defaultValue;
    return ['true', '1', 'yes', 'on'].includes(v.toLowerCase().trim());
  }
  private envNum(key: string, defaultValue: number): number {
    const v = this.config.get<string>(key);
    if (v == null || v === '') return defaultValue;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : defaultValue;
  }
}
