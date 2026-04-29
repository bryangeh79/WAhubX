// 2026-04-29 · P0-CS-3 · 账号体检 + 一键恢复 service
//
// 核心原则 (用户拍板的 P0 边界):
//   1. 单 slot 操作 · 永远不批量
//   2. stop+start runtime 只在 runtime 真坏 (process not running OR heartbeat stale > 180s) 时用
//      watcher 不健康单独不触发重启 · 依赖 runtime 内 30s healthcheck 自愈
//   3. QR 状态只设 needScan=true · 不清 session/profile/cookie
//   4. failed task / takeover lock / quarantine / suspended_until · P0 只报告不动
//   5. 所有调用都写 recovery_audit (action_type='diagnose'/'recover')
//
// 不动 (Do Not Touch):
//   sendText / session/profile/cookie 清理 / 8s aggregation / takeover lock 核心
//   dispatcher 调度 / inbound-watcher dedupe-MutationObserver-extractHint 内逻辑

import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SlotsService } from './slots.service';
import { AccountSlotStatus, AccountSlotRole } from './account-slot.entity';
import type { SlotResponseDto } from './dto/slot-response.dto';
import { RuntimeBridgeService } from '../runtime-bridge/runtime-bridge.service';
import { RuntimeProcessManagerService } from '../runtime-process/runtime-process-manager.service';
import { TakeoverLockService } from '../takeover/takeover-lock.service';
import { RecoveryAuditEntity } from './recovery-audit.entity';

// ─── 类型定义 (跟前端共用 · 见 frontend/src/lib/slot-health-types.ts) ───

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'unknown';
export type OverallStatus = 'healthy' | 'warning' | 'critical' | 'unknown';
export type RecoverResultCode = 'success' | 'partial' | 'failed' | 'need_scan';

export interface HealthCheck {
  key: string;
  status: CheckStatus;
  labelZh: string;
  value: string | number | boolean | null;
  messageZh: string;
  raw?: Record<string, unknown>;
}

export interface CheckupResult {
  slotId: number;
  accountId: number | null;
  phone: string | null;
  role: 'customer_service' | 'broadcast' | 'unknown';
  overallStatus: OverallStatus;
  summaryZh: string;
  recommendedActionZh: string;
  checks: HealthCheck[];
  generatedAt: string;
}

export interface ActionAttempted {
  key: string;
  status: CheckStatus;
  messageZh: string;
  raw?: Record<string, unknown>;
}
export interface ActionSkipped {
  key: string;
  reasonZh: string;
  raw?: Record<string, unknown>;
}

export interface RecoverResult {
  slotId: number;
  accountId: number | null;
  phone: string | null;
  result: RecoverResultCode;
  needScan: boolean;
  summaryZh: string;
  actionsAttempted: ActionAttempted[];
  actionsSkipped: ActionSkipped[];
  beforeDiagnose: CheckupResult;
  afterDiagnose: CheckupResult;
}

// ─── 阈值 (常量 · 不动 ag-window/dispatcher 等核心) ───

const HEARTBEAT_FRESH_MS = 60_000;          // < 60s = pass
const HEARTBEAT_WARN_MS = 180_000;          // 60-180s = warn · > 180s = fail (假死)
const RECENT_INBOUND_INFORMATIONAL_MS = 24 * 60 * 60 * 1000; // 客服号 last_inbound 距今 > 24h = warn (informational)
const TAKEOVER_STUCK_MS = 10 * 60 * 1000;   // takeover idle > 10min · 报告卡住
// failed task 查询直接用 SQL `created_at > NOW() - INTERVAL '1 hour'` · 不经常量

@Injectable()
export class SlotHealthService {
  private readonly logger = new Logger(SlotHealthService.name);

  constructor(
    private readonly slots: SlotsService,
    private readonly runtimeBridge: RuntimeBridgeService,
    private readonly runtimeProcess: RuntimeProcessManagerService,
    private readonly takeoverLocks: TakeoverLockService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(RecoveryAuditEntity)
    private readonly auditRepo: Repository<RecoveryAuditEntity>,
  ) {}

  // ════════════════════════════════════════════════════════════════
  // runCheckup · 12 项体检
  // ════════════════════════════════════════════════════════════════

  async runCheckup(slotId: number, tenantId: number, options: { writeAudit?: boolean } = {}): Promise<CheckupResult> {
    // 1. 验权限 + 拉 slot
    const slot = await this.slots.findOne(slotId, tenantId);
    const role: 'customer_service' | 'broadcast' | 'unknown' =
      slot.role === AccountSlotRole.CustomerService ? 'customer_service' :
      slot.role === AccountSlotRole.Broadcast ? 'broadcast' : 'unknown';

    const checks: HealthCheck[] = [];

    // ─── Check 1 · runtime_process 进程是否存在 ────────────
    const procState = this.runtimeProcess.getProcessState(slotId);
    const procRunning = procState.status === 'running' && procState.pid != null;
    checks.push({
      key: 'runtime_process',
      status: procRunning ? 'pass' : 'fail',
      labelZh: 'runtime 进程',
      value: procState.status,
      messageZh: procRunning
        ? `runtime 进程运行中 (PID ${procState.pid})`
        : `runtime 进程未运行 · 状态: ${procState.status}${procState.lastError ? ' · ' + procState.lastError : ''}`,
      raw: { ...procState } as unknown as Record<string, unknown>,
    });

    // ─── Check 2 · heartbeat_fresh 心跳新鲜度 ────────────
    const hbAt = slot.socketLastHeartbeatAt ? new Date(slot.socketLastHeartbeatAt).getTime() : null;
    const hbAgeMs = hbAt ? Date.now() - hbAt : null;
    let hbStatus: CheckStatus = 'unknown';
    let hbMsg = '心跳从未到达';
    if (hbAgeMs != null) {
      if (hbAgeMs < HEARTBEAT_FRESH_MS) { hbStatus = 'pass'; hbMsg = `心跳新鲜 (${Math.floor(hbAgeMs / 1000)}秒前)`; }
      else if (hbAgeMs < HEARTBEAT_WARN_MS) { hbStatus = 'warn'; hbMsg = `心跳偏慢 (${Math.floor(hbAgeMs / 1000)}秒前)`; }
      else { hbStatus = 'fail'; hbMsg = `心跳停滞 (${Math.floor(hbAgeMs / 1000)}秒前) · runtime 可能假死`; }
    }
    checks.push({
      key: 'heartbeat_fresh',
      status: hbStatus,
      labelZh: 'runtime 心跳',
      value: hbAgeMs != null ? `${Math.floor(hbAgeMs / 1000)}s` : null,
      messageZh: hbMsg,
      raw: { socketLastHeartbeatAt: slot.socketLastHeartbeatAt, ageMs: hbAgeMs },
    });

    // ─── Check 3 · WS 桥连接 + Check 4 · WA pageState ────────────
    const bridgeConnected = this.runtimeBridge.hasConnection(slotId);
    const cached = this.runtimeBridge.getCachedBindState(slotId);
    const pageState = bridgeConnected
      ? this.runtimeBridge.getCurrentPageState(slotId)
      : null;

    let waStatus: CheckStatus = 'unknown';
    let waValue: string = pageState ?? cached?.bindState ?? 'unknown';
    let waMsg = 'WA 状态未知';
    if (waValue === 'chat-list') { waStatus = 'pass'; waMsg = '已登录 · 在 chat-list'; }
    else if (waValue === 'qr') { waStatus = 'fail'; waMsg = 'WhatsApp Web 当前为 QR 状态 · 需要扫码'; }
    else if (waValue === 'splash' || waValue === 'connecting' || waValue === 'starting') {
      waStatus = 'warn'; waMsg = `WA 加载中 (${waValue}) · 请稍候`;
    } else if (waValue === 'splash-stuck' || waValue === 'failed' || waValue === 'closed') {
      waStatus = 'fail'; waMsg = `WA 异常 (${waValue})`;
    } else {
      waStatus = 'unknown';
    }
    checks.push({
      key: 'wa_state',
      status: waStatus,
      labelZh: 'WA 页面状态',
      value: waValue,
      messageZh: waMsg,
      raw: { pageState, cachedBindState: cached?.bindState ?? null },
    });

    // need_scan = wa_state === qr
    const needScan = waValue === 'qr';
    checks.push({
      key: 'need_scan',
      status: needScan ? 'fail' : 'pass',
      labelZh: '是否需扫码',
      value: needScan,
      messageZh: needScan ? '需要重新扫码登录' : '不需要扫码',
    });

    // ─── Check 5 · watcher_installed ────────────
    // P0 启发式: bridgeConnected + pageState=chat-list + heartbeat fresh + uptime > 15s
    // = 默认认为 watcher 已装. 否则 unknown.
    let watcherStatus: CheckStatus = 'unknown';
    let watcherMsg = '无法判断 watcher 状态';
    let watcherValue: boolean | string = 'unknown';
    if (bridgeConnected && pageState === 'chat-list' && hbStatus === 'pass') {
      const uptimeMs = procState.startedAt ? Date.now() - procState.startedAt : 0;
      if (uptimeMs > 15_000) {
        watcherStatus = 'pass';
        watcherValue = true;
        watcherMsg = 'watcher 应已正常安装 (基于心跳 + chat-list + uptime 启发式)';
      } else {
        watcherStatus = 'warn';
        watcherValue = false;
        watcherMsg = 'runtime 刚起 · watcher 安装中 · 请稍候';
      }
    } else if (waValue === 'qr' || !bridgeConnected) {
      watcherStatus = 'fail';
      watcherValue = false;
      watcherMsg = 'WA 未登录 · watcher 不可能装';
    } else if (hbStatus === 'fail' || hbStatus === 'warn') {
      watcherStatus = 'warn';
      watcherValue = false;
      watcherMsg = '心跳异常 · watcher 状态不确定';
    }
    checks.push({
      key: 'watcher_installed',
      status: watcherStatus,
      labelZh: 'inbound watcher 已装',
      value: watcherValue,
      messageZh: watcherMsg,
    });

    // ─── Check 6 · inbound_watcher_heartbeat (复用 socket_last_heartbeat_at) ────
    checks.push({
      key: 'inbound_watcher_heartbeat',
      status: hbStatus,
      labelZh: 'watcher 心跳',
      value: hbAgeMs != null ? `${Math.floor(hbAgeMs / 1000)}s` : null,
      messageZh: 'watcher 心跳与 runtime 心跳共用 (P0 不区分)',
      raw: { ageMs: hbAgeMs },
    });

    // ─── Check 7 · recent_inbound_message · 最近 inbound 时间 (only customer_service) ────
    let lastInboundIso: string | null = null;
    if (role === 'customer_service' && slot.accountId != null) {
      const rows = await this.dataSource.query<Array<{ last_inbound_at: Date | null }>>(
        `SELECT MAX(c.last_inbound_at) as last_inbound_at
         FROM customer_conversation c
         WHERE c.tenant_id = $1 AND c.slot_id = $2`,
        [tenantId, slotId],
      );
      lastInboundIso = rows[0]?.last_inbound_at ? new Date(rows[0].last_inbound_at).toISOString() : null;
    }
    let inboundStatus: CheckStatus = 'unknown';
    let inboundMsg = '仅客服号检查此项';
    if (role === 'customer_service') {
      if (!lastInboundIso) {
        inboundStatus = 'warn';
        inboundMsg = '客服号还没收到过任何 inbound · 可能是新号或没人联系';
      } else {
        const ageMs = Date.now() - new Date(lastInboundIso).getTime();
        if (ageMs < RECENT_INBOUND_INFORMATIONAL_MS) {
          inboundStatus = 'pass';
          inboundMsg = `${Math.floor(ageMs / 60_000)} 分钟前有 inbound`;
        } else {
          inboundStatus = 'warn';
          inboundMsg = `> 24h 没 inbound (上次 ${lastInboundIso}) · 可能 watcher 没工作或没人联系`;
        }
      }
    }
    checks.push({
      key: 'recent_inbound_message',
      status: inboundStatus,
      labelZh: '最近 inbound 消息',
      value: lastInboundIso,
      messageZh: inboundMsg,
    });

    // ─── Check 8 · recent_ai_audit · 最近 AI 回复 (informational) ────
    const auditRows = await this.dataSource.query<Array<{ created_at: Date | null }>>(
      `SELECT MAX(created_at) as created_at FROM ai_reply_audit
       WHERE tenant_id = $1 AND draft = false`,
      [tenantId],
    );
    const lastAuditIso = auditRows[0]?.created_at ? new Date(auditRows[0].created_at).toISOString() : null;
    checks.push({
      key: 'recent_ai_audit',
      status: 'unknown', // informational only
      labelZh: '最近 AI 回复',
      value: lastAuditIso,
      messageZh: lastAuditIso
        ? `tenant 最近 AI 回复时间: ${lastAuditIso}`
        : 'tenant 还没产生过任何 AI 回复',
    });

    // ─── Check 9 · unread_backlog · P0 unknown ────
    checks.push({
      key: 'unread_backlog',
      status: 'unknown',
      labelZh: 'unread 待处理',
      value: 'unknown',
      messageZh: 'P0 无法可靠读取 unread badge · 恢复后由 watcher 多档 rescan 自动补扫',
    });

    // ─── Check 10 · failed_tasks_stuck · 1h 内 failed task ────
    const failedRows = await this.dataSource.query<Array<{ id: number; last_error: string | null; created_at: Date }>>(
      `SELECT id, last_error, created_at FROM task
       WHERE tenant_id = $1
         AND status = 'failed'
         AND payload IS NOT NULL
         AND (payload->>'slotId')::int = $2
         AND created_at > NOW() - INTERVAL '1 hour'
       ORDER BY id DESC LIMIT 10`,
      [tenantId, slotId],
    );
    checks.push({
      key: 'failed_tasks_stuck',
      status: failedRows.length === 0 ? 'pass' : 'warn',
      labelZh: '卡住的 failed task',
      value: failedRows.length,
      messageZh: failedRows.length === 0
        ? '近 1h 无 failed task'
        : `近 1h 有 ${failedRows.length} 个 failed task · P0 不会自动重置 · 请手动到任务页处理`,
      raw: { taskIds: failedRows.map((r) => r.id), errors: failedRows.map((r) => r.last_error).slice(0, 3) },
    });

    // ─── Check 11 · takeover_lock · 接管锁是否卡住 ────
    let takeoverStatus: CheckStatus = 'pass';
    let takeoverMsg = '无 takeover 锁定';
    let takeoverRaw: Record<string, unknown> | undefined = undefined;
    if (slot.accountId != null) {
      const lock = this.takeoverLocks.getLock(slot.accountId);
      if (lock) {
        if (lock.idleMs > TAKEOVER_STUCK_MS) {
          takeoverStatus = 'warn';
          takeoverMsg = `接管锁卡住 ${Math.floor(lock.idleMs / 60_000)} 分钟 · P0 不自动释放 · 请到接管页面手动释放`;
        } else {
          takeoverStatus = 'pass';
          takeoverMsg = `接管中 (${lock.userEmail}) · idle ${Math.floor(lock.idleMs / 1000)}s`;
        }
        takeoverRaw = lock as unknown as Record<string, unknown>;
      }
    }
    checks.push({
      key: 'takeover_lock',
      status: takeoverStatus,
      labelZh: 'takeover 锁',
      value: slot.accountId ? !!this.takeoverLocks.getLock(slot.accountId) : false,
      messageZh: takeoverMsg,
      raw: takeoverRaw,
    });

    // ─── Check 12 · quarantine_suspended ────
    const isQuarantine = slot.status === AccountSlotStatus.Quarantine;
    const isSuspended = slot.suspendedUntil && new Date(slot.suspendedUntil).getTime() > Date.now();
    checks.push({
      key: 'quarantine_suspended',
      status: (isQuarantine || isSuspended) ? 'fail' : 'pass',
      labelZh: '隔离/暂停',
      value: isQuarantine ? 'quarantine' : isSuspended ? `suspended_until=${slot.suspendedUntil}` : 'none',
      messageZh: isQuarantine
        ? '账号已被 quarantine (连续 2 次 440) · 需原厂重置换号 · P0 不自动解除'
        : isSuspended
        ? `账号 suspended 至 ${slot.suspendedUntil} · P0 不自动解除`
        : '账号正常',
      raw: { status: slot.status, suspendedUntil: slot.suspendedUntil },
    });

    // ─── 计算 overallStatus ────
    let overallStatus: OverallStatus = 'healthy';
    if (checks.some((c) => c.status === 'fail')) overallStatus = 'critical';
    else if (checks.some((c) => c.status === 'warn')) overallStatus = 'warning';
    else if (checks.every((c) => c.status === 'unknown')) overallStatus = 'unknown';

    // ─── 生成 summaryZh + recommendedActionZh ────
    const { summaryZh, recommendedActionZh } = this.buildSummary(slot, role, overallStatus, checks, needScan);

    const result: CheckupResult = {
      slotId,
      accountId: slot.accountId,
      phone: slot.phoneNumber,
      role,
      overallStatus,
      summaryZh,
      recommendedActionZh,
      checks,
      generatedAt: new Date().toISOString(),
    };

    // ─── 可选写 audit (recover 内部调用时设 writeAudit=false 避免重复) ────
    if (options.writeAudit !== false) {
      try {
        await this.auditRepo.save(this.auditRepo.create({
          tenantId,
          slotId,
          accountId: slot.accountId,
          actionType: 'diagnose',
          result: 'diagnose_only',
          needScan,
          beforeSnapshot: null,
          afterSnapshot: result as unknown as Record<string, unknown>,
          actionsAttempted: null,
          actionsSkipped: null,
          operatorUserId: null, // 可后续在 controller 传
        }));
      } catch (err) {
        this.logger.warn(`audit write failed: ${err instanceof Error ? err.message : err}`);
      }
    }

    return result;
  }

  private buildSummary(
    slot: SlotResponseDto,
    role: 'customer_service' | 'broadcast' | 'unknown',
    overallStatus: OverallStatus,
    checks: HealthCheck[],
    needScan: boolean,
  ): { summaryZh: string; recommendedActionZh: string } {
    const roleZh = role === 'customer_service' ? '客服号' : role === 'broadcast' ? '广告号' : '账号';
    const phone = slot.phoneNumber ?? `slot #${slot.slotIndex}`;
    const head = `${roleZh} ${phone}`;

    // 关键问题优先级
    const quarantine = checks.find((c) => c.key === 'quarantine_suspended' && c.status === 'fail');
    const procFail = checks.find((c) => c.key === 'runtime_process' && c.status === 'fail');
    const hbFail = checks.find((c) => c.key === 'heartbeat_fresh' && c.status === 'fail');
    const failedTasks = checks.find((c) => c.key === 'failed_tasks_stuck' && c.status === 'warn');
    const takeoverStuck = checks.find((c) => c.key === 'takeover_lock' && c.status === 'warn');

    if (quarantine) {
      return {
        summaryZh: `${head} · 状态: 已隔离/暂停\n原因: ${quarantine.messageZh}\n影响: 该号无法工作`,
        recommendedActionZh: 'P0 不自动解除 · 联系管理员或原厂重置换号',
      };
    }
    if (needScan) {
      return {
        summaryZh: `${head} · 状态: 需要扫码\n原因: WhatsApp Web 当前为 QR 状态\n影响: ${role === 'customer_service' ? 'AI 客服暂停, 客户消息不会自动回复' : '广告投放无法发送'}`,
        recommendedActionZh: '请在接管页面重新扫码 · 扫码成功后再执行一键恢复',
      };
    }
    if (procFail) {
      return {
        summaryZh: `${head} · 状态: runtime 未启动\n原因: ${procFail.messageZh}`,
        recommendedActionZh: '点一键恢复 · 自动启动 runtime',
      };
    }
    if (hbFail) {
      return {
        summaryZh: `${head} · 状态: runtime 假死\n原因: ${hbFail.messageZh}`,
        recommendedActionZh: '点一键恢复 · 重启 runtime · 期间约 10-20 秒不可用',
      };
    }
    if (overallStatus === 'healthy') {
      return {
        summaryZh: `${head} · 状态: 正常运行`,
        recommendedActionZh: '无需操作',
      };
    }

    // warning 级
    const warnings: string[] = [];
    if (failedTasks) warnings.push(failedTasks.messageZh);
    if (takeoverStuck) warnings.push(takeoverStuck.messageZh);
    return {
      summaryZh: `${head} · 状态: 有警告\n${warnings.join('\n')}`,
      recommendedActionZh: '检查上面警告项 · P0 不自动处理 · 必要时手动到对应页面操作',
    };
  }

  // ════════════════════════════════════════════════════════════════
  // runRecover · 状态驱动恢复
  // ════════════════════════════════════════════════════════════════

  async runRecover(slotId: number, tenantId: number, operatorUserId: number | null): Promise<RecoverResult> {
    // 1. before checkup (不写 audit · 留到末尾合并写)
    const before = await this.runCheckup(slotId, tenantId, { writeAudit: false });

    const actionsAttempted: ActionAttempted[] = [];
    const actionsSkipped: ActionSkipped[] = [];

    // 2. 决策 (按 plan 表)
    const slot = await this.slots.findOne(slotId, tenantId);

    const procCheck = before.checks.find((c) => c.key === 'runtime_process');
    const hbCheck = before.checks.find((c) => c.key === 'heartbeat_fresh');
    const waCheck = before.checks.find((c) => c.key === 'wa_state');
    const watcherCheck = before.checks.find((c) => c.key === 'watcher_installed');
    const failedTaskCheck = before.checks.find((c) => c.key === 'failed_tasks_stuck');
    const takeoverCheck = before.checks.find((c) => c.key === 'takeover_lock');
    const quarantineCheck = before.checks.find((c) => c.key === 'quarantine_suspended');

    // ─── 第一优先级 · quarantine/suspended → 直接 SKIP 全部 · result=failed ───
    if (quarantineCheck?.status === 'fail') {
      actionsSkipped.push({
        key: 'quarantine_suspended',
        reasonZh: '账号已隔离/暂停 · P0 不自动解除',
        raw: quarantineCheck.raw,
      });
      const after = before; // 不动则等同
      const finalResult: RecoverResultCode = 'failed';
      return await this.finalize(slotId, tenantId, slot, before, after, actionsAttempted, actionsSkipped, finalResult, false, '账号已隔离/暂停 · 不能恢复', operatorUserId);
    }

    // ─── takeover lock 卡住 · SKIP 但继续其他 (informational) ───
    if (takeoverCheck?.status === 'warn') {
      actionsSkipped.push({
        key: 'takeover_lock',
        reasonZh: 'takeover lock 卡住 · P0 不自动释放 · 请到接管页面手动释放',
        raw: takeoverCheck.raw,
      });
    }

    // ─── failed task SKIP (informational) ───
    if (failedTaskCheck?.status === 'warn') {
      actionsSkipped.push({
        key: 'failed_tasks',
        reasonZh: 'P0 不自动重置 failed task · 请到任务页面手动处理',
        raw: failedTaskCheck.raw,
      });
    }

    // ─── 主决策: runtime 进程 ───
    const procRunning = procCheck?.status === 'pass';
    const hbStale = hbCheck?.status === 'fail';
    const waIsQr = waCheck?.value === 'qr';
    const waIsChatList = waCheck?.value === 'chat-list';

    if (!procRunning) {
      // Case 1: runtime 不在 → 启动
      try {
        const r = await this.runtimeProcess.start(slotId);
        actionsAttempted.push({
          key: 'runtime_start',
          status: 'pass',
          messageZh: `runtime 已启动 (PID ${r.pid ?? '-'})`,
          raw: { ...r } as unknown as Record<string, unknown>,
        });
      } catch (err) {
        actionsAttempted.push({
          key: 'runtime_start',
          status: 'fail',
          messageZh: `runtime 启动失败: ${err instanceof Error ? err.message : err}`,
        });
      }
    } else if (hbStale) {
      // Case 2: runtime 在但心跳停滞 → stop+start (fallback 成立 · runtime 假死)
      try {
        await this.runtimeProcess.stop(slotId, { graceful: true, timeoutMs: 10_000 });
        await new Promise((r) => setTimeout(r, 1000));
        const r = await this.runtimeProcess.start(slotId);
        actionsAttempted.push({
          key: 'runtime_restart',
          status: 'pass',
          messageZh: `已重启 runtime (PID ${r.pid ?? '-'}) · 触发 watcher 重装 + P0-CS-2 多档 rescan`,
          raw: { ...r } as unknown as Record<string, unknown>,
        });
      } catch (err) {
        actionsAttempted.push({
          key: 'runtime_restart',
          status: 'fail',
          messageZh: `runtime 重启失败: ${err instanceof Error ? err.message : err}`,
        });
      }
    } else if (waIsQr) {
      // Case 3: runtime 健康 + QR · SKIP · 让前端提示扫码
      actionsSkipped.push({
        key: 'qr_scan_required',
        reasonZh: '需要重新扫码 · P0 不清 session/profile/cookie · 请在接管页面扫码',
      });
    } else if (waIsChatList && watcherCheck?.status === 'pass') {
      // Case 4 (健康): runtime + chat-list + watcher 全好 → 仍跑 post-login-recovery 巩固
      //   2026-04-29 · P0.5-CS · 改为轻量 RPC · 不再 NO ACTION
      //   即使健康也跑一次 reinstall+rescan 巩固 (RPC 失败不影响 result)
      try {
        const recovery = await this.runtimeBridge.postLoginRecovery(slotId, 1500);
        if (recovery.ok && recovery.data?.ok) {
          actionsAttempted.push({
            key: 'post_login_recovery',
            status: 'pass',
            messageZh: `post-login-recovery 完成 · ${recovery.data.result} (轻量路径 · 不重启 Chromium)`,
            raw: recovery.data as unknown as Record<string, unknown>,
          });
        } else {
          actionsAttempted.push({
            key: 'post_login_recovery',
            status: 'warn',
            messageZh: `post-login-recovery 未完全成功: ${recovery.error ?? recovery.data?.result ?? 'unknown'}`,
            raw: recovery.data as unknown as Record<string, unknown>,
          });
        }
      } catch (err) {
        actionsAttempted.push({
          key: 'post_login_recovery',
          status: 'warn',
          messageZh: `post-login-recovery 异常 (不影响在线): ${err instanceof Error ? err.message : err}`,
        });
      }
    } else if (waIsChatList && watcherCheck && watcherCheck.status !== 'pass') {
      // Case 4 (watcher 不健康): runtime healthy + chat-list 但 watcher unhealthy
      //   2026-04-29 · P0.5-CS · 用轻量 RPC 修 · 不重启 Chromium
      //   流程: reinstall-watcher → rescan-inbound · 失败才 fallback
      try {
        const reinstall = await this.runtimeBridge.reinstallWatcher(slotId, true);
        if (reinstall.ok && reinstall.data?.ok) {
          actionsAttempted.push({
            key: 'reinstall_watcher_rpc',
            status: 'pass',
            messageZh: `已重装 watcher (轻量 RPC · 不重启 Chromium)`,
            raw: reinstall.data as unknown as Record<string, unknown>,
          });
          const rescan = await this.runtimeBridge.rescanInbound(slotId);
          actionsAttempted.push({
            key: 'rescan_inbound_rpc',
            status: rescan.ok ? 'pass' : 'warn',
            messageZh: rescan.ok ? '已触发 rescan-inbound' : `rescan-inbound 失败: ${rescan.error ?? rescan.data?.reason ?? '?'}`,
            raw: rescan.data as unknown as Record<string, unknown>,
          });
        } else {
          // RPC 失败 · fallback 提醒等 30s 自检
          actionsSkipped.push({
            key: 'reinstall_watcher_rpc',
            reasonZh: `reinstall-watcher RPC 失败 (${reinstall.error ?? '?'}) · fallback 等 runtime 30s 自检`,
            raw: reinstall.data as unknown as Record<string, unknown>,
          });
        }
      } catch (err) {
        actionsSkipped.push({
          key: 'reinstall_watcher_rpc',
          reasonZh: `RPC 调用异常 (${err instanceof Error ? err.message : err}) · fallback 等 runtime 30s 自检`,
        });
      }
    } else {
      // 兜底: 其他状态 (splash/connecting/unknown) · 不动
      actionsSkipped.push({
        key: 'wait_state_settle',
        reasonZh: `WA 处于 ${waCheck?.value ?? 'unknown'} 状态 · 等其稳定再操作`,
        raw: waCheck?.raw,
      });
    }

    // 3. 等 5s 让 start/restart 后状态更新
    if (actionsAttempted.some((a) => a.key === 'runtime_start' || a.key === 'runtime_restart')) {
      await new Promise((r) => setTimeout(r, 5000));
    }

    // 4. after checkup
    const after = await this.runCheckup(slotId, tenantId, { writeAudit: false });

    // 5. 计算 finalResult + summary
    const needScan = after.checks.some((c) => c.key === 'need_scan' && c.status === 'fail');
    let finalResult: RecoverResultCode = 'success';
    let summary: string;

    if (needScan) {
      finalResult = 'need_scan';
      summary = '需要扫码 · 已尝试可做的恢复但 WA 还在 QR 状态';
    } else if (actionsAttempted.some((a) => a.status === 'fail')) {
      finalResult = 'failed';
      summary = '部分动作失败 · 详见 actionsAttempted';
    } else if (after.overallStatus === 'healthy') {
      finalResult = 'success';
      summary = actionsAttempted.length === 0
        ? '账号本身已正常 · 无需恢复动作'
        : '恢复完成 · 账号已健康';
    } else {
      finalResult = 'partial';
      summary = '部分恢复 · 仍有警告项 · 详见 afterDiagnose';
    }

    return await this.finalize(slotId, tenantId, slot, before, after, actionsAttempted, actionsSkipped, finalResult, needScan, summary, operatorUserId);
  }

  private async finalize(
    slotId: number,
    tenantId: number,
    slot: SlotResponseDto,
    before: CheckupResult,
    after: CheckupResult,
    actionsAttempted: ActionAttempted[],
    actionsSkipped: ActionSkipped[],
    result: RecoverResultCode,
    needScan: boolean,
    summary: string,
    operatorUserId: number | null,
  ): Promise<RecoverResult> {
    // 写 recovery_audit
    try {
      await this.auditRepo.save(this.auditRepo.create({
        tenantId,
        slotId,
        accountId: slot.accountId,
        actionType: 'recover',
        result,
        needScan,
        beforeSnapshot: before as unknown as Record<string, unknown>,
        afterSnapshot: after as unknown as Record<string, unknown>,
        actionsAttempted: actionsAttempted as unknown as Array<Record<string, unknown>>,
        actionsSkipped: actionsSkipped as unknown as Array<Record<string, unknown>>,
        operatorUserId,
      }));
    } catch (err) {
      this.logger.warn(`recover audit write failed: ${err instanceof Error ? err.message : err}`);
    }

    return {
      slotId,
      accountId: slot.accountId,
      phone: slot.phoneNumber,
      result,
      needScan,
      summaryZh: summary,
      actionsAttempted,
      actionsSkipped,
      beforeDiagnose: before,
      afterDiagnose: after,
    };
  }
}
