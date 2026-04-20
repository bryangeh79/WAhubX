// M9 · Takeover Lock 核心状态机
//
// 职责:
//   1. acquire(accountId, user)    抢占锁, 置 account_slot.takeover_active=true, 触发 graceful-pause
//   2. release(accountId, user)    手动释放, 清标志, 恢复 pending 任务
//   3. hardKill(accountId, user)   30s 未等到 pause 的逃生口, 正跑的 task_run → interrupted
//   4. heartbeat(accountId)        UI 有操作 (发消息 / typing) 时延长 idle timer
//   5. socket connect/disconnect   10s grace 容错 UI 刷新, 不立即释放
//   6. isPaused(accountId)         executor 在 breakpoint 查询, 返 true 要 throw TaskPausedError
//
// 设计:
//   - 内存 Map<accountId, LockState> + DB account_slot.takeover_active 双写
//   - 进程重启: 内存丢, DB flag 残留 → onModuleInit 清 stale flag (takeover_active=true 但无内存锁)
//   - 30min idle timer: lastActivityAt + 28min 预警 / 30min 自动释放
//   - disconnect grace: socket 断 → 启 10s timer, 10s 内重连清 timer, 否则走常规 idle (不主动释放)
//
// §B.8 优先级体系 (手动=1 > 业务=3 > 养号=5 > 保活=7) — 当前 V1 单用户, 锁不会被抢占, 只会被
// 同一 acquire 者 release. V2 multi-user 再扩展 stealFrom().

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AccountSlotEntity } from '../slots/account-slot.entity';
import { TaskRunEntity, TaskRunStatus } from '../tasks/task-run.entity';
import { TaskEntity } from '../tasks/task.entity';
import { UserRole } from '../users/user.entity';
import type { RequestUser } from '../auth/decorators/current-user.decorator';
import {
  TAKEOVER_ACQUIRED,
  TAKEOVER_HARD_KILL,
  TAKEOVER_IDLE_TIMEOUT,
  TAKEOVER_IDLE_WARNING,
  TAKEOVER_RELEASED,
  type TakeoverAcquiredEvent,
  type TakeoverHardKillEvent,
  type TakeoverIdleEvent,
  type TakeoverReleasedEvent,
} from './takeover.events';
import { TakeoverLockError } from './takeover.errors';

interface LockState {
  accountId: number;
  slotId: number;
  tenantId: number;
  userId: string;
  userEmail: string;
  acquiredAt: Date;
  lastActivityAt: Date;
  // socket ids currently subscribed (room 'takeover:account:<id>'); 可多个 tab
  socketIds: Set<string>;
  // 所有 socket 断开时启 10s grace · 期间保 lock · 过期 → 按 idle 常规流程 (不主动释 disconnect timeout)
  disconnectTimer: NodeJS.Timeout | null;
  // 28min idle 预警标志 (同一段 idle 只警告一次)
  warningEmitted: boolean;
}

// 默认 config 可被 env 覆盖 (保守, 测试用 TAKEOVER_* 改短)
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;  // 30 min
const DEFAULT_IDLE_WARNING_MS = 28 * 60 * 1000;  // 28 min (idle 警告)
const DEFAULT_DISCONNECT_GRACE_MS = 10_000;       // 10s socket 重连窗口
const DEFAULT_SWEEP_INTERVAL_MS = 30_000;         // 30s 扫一轮 idle 状态

@Injectable()
export class TakeoverLockService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TakeoverLockService.name);
  private readonly locks = new Map<number, LockState>();
  private sweepTimer: NodeJS.Timeout | null = null;

  private readonly idleTimeoutMs: number;
  private readonly idleWarningMs: number;
  private readonly disconnectGraceMs: number;
  private readonly sweepIntervalMs: number;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    @Optional() private readonly eventBus?: EventEmitter2,
  ) {
    this.idleTimeoutMs = this.config.get<number>('TAKEOVER_IDLE_TIMEOUT_MS', DEFAULT_IDLE_TIMEOUT_MS);
    this.idleWarningMs = this.config.get<number>('TAKEOVER_IDLE_WARNING_MS', DEFAULT_IDLE_WARNING_MS);
    this.disconnectGraceMs = this.config.get<number>('TAKEOVER_DISCONNECT_GRACE_MS', DEFAULT_DISCONNECT_GRACE_MS);
    this.sweepIntervalMs = this.config.get<number>('TAKEOVER_SWEEP_INTERVAL_MS', DEFAULT_SWEEP_INTERVAL_MS);
  }

  async onModuleInit(): Promise<void> {
    // 进程重启 · 清 DB 残留 takeover_active=true (内存锁已丢, 卡住任务永不解)
    const repo = this.dataSource.getRepository(AccountSlotEntity);
    const stale = await repo.createQueryBuilder('s').where('s.takeover_active = true').getMany();
    if (stale.length > 0) {
      this.logger.warn(`onModuleInit · 发现 ${stale.length} 个残留 takeover_active 锁, 强制清 (进程重启)`);
      await repo.createQueryBuilder().update().set({ takeoverActive: false }).where('takeover_active = true').execute();
    }

    this.sweepTimer = setInterval(() => {
      this.sweepIdleLocks().catch((err) => this.logger.error(`sweep error: ${err}`));
    }, this.sweepIntervalMs);
    this.logger.log(
      `TakeoverLock ready · idle_timeout=${Math.round(this.idleTimeoutMs / 60000)}min · warning=${Math.round(this.idleWarningMs / 60000)}min · disconnect_grace=${this.disconnectGraceMs}ms`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    // 不清 DB flag · 进程重启 onModuleInit 会清. 这里保持内存清理即可.
    for (const state of this.locks.values()) {
      if (state.disconnectTimer) clearTimeout(state.disconnectTimer);
    }
    this.locks.clear();
  }

  // ── 权限门 · F 决策: admin role 可 acquire, operator/viewer 403 ─────
  assertCanTakeover(user: RequestUser | undefined, tenantId: number | null): void {
    if (!user) {
      throw new TakeoverLockError('PERMISSION_DENIED', '未登录');
    }
    if (user.role !== UserRole.Admin) {
      throw new TakeoverLockError('PERMISSION_DENIED', `role=${user.role} 不可接管 · 仅 admin 可用`);
    }
    // 平台超管 (tenantId=null) 可跨租户. 租户 admin 仅限自己租户.
    if (user.tenantId !== null && user.tenantId !== tenantId) {
      throw new TakeoverLockError('PERMISSION_DENIED', '不可跨租户接管');
    }
  }

  // ── acquire ──────────────────────────────────────────────
  async acquire(accountId: number, user: RequestUser): Promise<LockStateView> {
    const slot = await this.dataSource
      .getRepository(AccountSlotEntity)
      .findOne({ where: { accountId } });
    if (!slot) throw new TakeoverLockError('SLOT_NOT_FOUND', `account ${accountId} 没有槽位`);
    if (!slot.accountId) throw new TakeoverLockError('ACCOUNT_NOT_BOUND', `槽位 ${slot.id} 未绑定账号`);
    this.assertCanTakeover(user, slot.tenantId);

    const existing = this.locks.get(accountId);
    if (existing) {
      if (existing.userId !== user.id) {
        throw new TakeoverLockError(
          'LOCK_HELD_BY_OTHER',
          `账号 ${accountId} 已被 ${existing.userEmail} 接管`,
        );
      }
      // 同用户重复 acquire · 刷新 lastActivity · 幂等返回
      existing.lastActivityAt = new Date();
      existing.warningEmitted = false;
      return this.toView(existing);
    }

    // 写 DB flag (dispatcher skip-takeover-active #4 已用此字段)
    await this.dataSource
      .getRepository(AccountSlotEntity)
      .update(slot.id, { takeoverActive: true });

    const state: LockState = {
      accountId,
      slotId: slot.id,
      tenantId: slot.tenantId,
      userId: user.id,
      userEmail: user.email,
      acquiredAt: new Date(),
      lastActivityAt: new Date(),
      socketIds: new Set(),
      disconnectTimer: null,
      warningEmitted: false,
    };
    this.locks.set(accountId, state);

    this.logger.log(`acquire · acc=${accountId} slot=${slot.id} user=${user.email}`);
    this.emit(TAKEOVER_ACQUIRED, {
      accountId,
      slotId: slot.id,
      userId: user.id,
      userEmail: user.email,
      acquiredAt: state.acquiredAt.toISOString(),
    } satisfies TakeoverAcquiredEvent);

    return this.toView(state);
  }

  // ── release ──────────────────────────────────────────────
  async release(
    accountId: number,
    user: RequestUser | null,
    reason: TakeoverReleasedEvent['reason'] = 'manual',
  ): Promise<void> {
    const state = this.locks.get(accountId);
    if (!state) {
      // 幂等 · DB flag 可能残留, 保险起见清
      await this.dataSource
        .getRepository(AccountSlotEntity)
        .update({ accountId }, { takeoverActive: false });
      return;
    }
    if (user && user.id !== state.userId && user.role !== UserRole.Admin) {
      // 其他用户强制 release (V1 admin 都放行; V2 做 steal 语义)
      throw new TakeoverLockError('PERMISSION_DENIED', '不可释放他人锁');
    }
    if (state.disconnectTimer) clearTimeout(state.disconnectTimer);
    this.locks.delete(accountId);

    await this.dataSource
      .getRepository(AccountSlotEntity)
      .update(state.slotId, { takeoverActive: false });

    // 恢复 paused 的 task · 清 task.paused_at 让 dispatcher 下一 tick 重评估
    await this.dataSource
      .createQueryBuilder()
      .update(TaskEntity)
      .set({ pausedAt: null })
      .where('paused_at IS NOT NULL')
      .andWhere('id IN (SELECT task_id FROM task_run WHERE account_id = :aid AND status = :s)', {
        aid: accountId,
        s: TaskRunStatus.Paused,
      })
      .execute();

    this.logger.log(`release · acc=${accountId} reason=${reason} user=${user?.email ?? 'system'}`);
    this.emit(TAKEOVER_RELEASED, {
      accountId,
      reason,
      userId: user?.id ?? null,
    } satisfies TakeoverReleasedEvent);
  }

  // ── hardKill ─────────────────────────────────────────────
  async hardKill(accountId: number, user: RequestUser): Promise<number[]> {
    const state = this.locks.get(accountId);
    if (!state) throw new TakeoverLockError('NO_ACTIVE_LOCK', `account ${accountId} 无活跃锁`);
    if (state.userId !== user.id && user.role !== UserRole.Admin) {
      throw new TakeoverLockError('PERMISSION_DENIED', '不可强制中断他人会话');
    }
    // 把正跑的 (status=running) task_run 标 interrupted
    const runs = await this.dataSource
      .getRepository(TaskRunEntity)
      .createQueryBuilder('r')
      .where('r.account_id = :aid', { aid: accountId })
      .andWhere('r.status = :s', { s: TaskRunStatus.Running })
      .getMany();

    const runIds = runs.map((r) => r.id);
    if (runIds.length > 0) {
      await this.dataSource
        .createQueryBuilder()
        .update(TaskRunEntity)
        .set({
          status: TaskRunStatus.Interrupted,
          errorCode: 'TAKEOVER_HARD_KILL',
          errorMessage: `由 ${user.email} 强制中断 (30s graceful pause 超时)`,
          finishedAt: () => 'NOW()',
        })
        .whereInIds(runIds)
        .execute();
    }
    state.lastActivityAt = new Date();
    this.logger.warn(`hardKill · acc=${accountId} user=${user.email} interrupted_runs=[${runIds.join(',')}]`);
    this.emit(TAKEOVER_HARD_KILL, {
      accountId,
      interruptedRunIds: runIds,
      userId: user.id,
    } satisfies TakeoverHardKillEvent);
    return runIds;
  }

  // ── heartbeat / idle 管理 ────────────────────────────────
  heartbeat(accountId: number, user?: RequestUser): void {
    const state = this.locks.get(accountId);
    if (!state) return;
    if (user && user.id !== state.userId) return; // 非锁持有者的心跳不更新
    state.lastActivityAt = new Date();
    state.warningEmitted = false;
  }

  // executor 查询: 该账号是否正被接管 (M9 pauseCheck 用)
  isPaused(accountId: number): boolean {
    return this.locks.has(accountId);
  }

  // ── socket 连/断 ──────────────────────────────────────────
  onSocketConnect(accountId: number, socketId: string, user: RequestUser): void {
    const state = this.locks.get(accountId);
    if (!state) return;
    if (state.userId !== user.id && user.role !== UserRole.Admin) return;
    if (state.disconnectTimer) {
      clearTimeout(state.disconnectTimer);
      state.disconnectTimer = null;
      this.logger.log(`acc=${accountId} socket reconnected within grace window (sock=${socketId})`);
    }
    state.socketIds.add(socketId);
    state.lastActivityAt = new Date();
  }

  onSocketDisconnect(accountId: number, socketId: string): void {
    const state = this.locks.get(accountId);
    if (!state) return;
    state.socketIds.delete(socketId);
    if (state.socketIds.size > 0) return; // 还有别的 tab 连着

    // 全断 · 启 10s grace · 期间不释放, 10s 后走正常 idle 流程
    if (state.disconnectTimer) clearTimeout(state.disconnectTimer);
    state.disconnectTimer = setTimeout(() => {
      state.disconnectTimer = null;
      this.logger.warn(
        `acc=${accountId} 10s disconnect grace expired · lock 仍保持 · 由 idle_timeout 兜底`,
      );
    }, this.disconnectGraceMs);
  }

  // ── 查 ───────────────────────────────────────────────────
  getLock(accountId: number): LockStateView | null {
    const state = this.locks.get(accountId);
    return state ? this.toView(state) : null;
  }

  listLocks(): LockStateView[] {
    return Array.from(this.locks.values()).map((s) => this.toView(s));
  }

  // ── idle sweep · 30s 扫 / 28min 预警 / 30min 自动释放 ─────
  private async sweepIdleLocks(): Promise<void> {
    const now = Date.now();
    for (const [accountId, state] of this.locks) {
      const idleMs = now - state.lastActivityAt.getTime();
      if (idleMs >= this.idleTimeoutMs) {
        this.logger.warn(`sweep · acc=${accountId} idle ${Math.round(idleMs / 60000)}min 超时 · 自动释放`);
        this.emit(TAKEOVER_IDLE_TIMEOUT, {
          accountId,
          minutesIdle: Math.round(idleMs / 60000),
        } satisfies TakeoverIdleEvent);
        await this.release(accountId, null, 'idle_timeout');
        continue;
      }
      if (idleMs >= this.idleWarningMs && !state.warningEmitted) {
        state.warningEmitted = true;
        this.emit(TAKEOVER_IDLE_WARNING, {
          accountId,
          minutesIdle: Math.round(idleMs / 60000),
        } satisfies TakeoverIdleEvent);
      }
    }
  }

  private emit<T>(channel: string, payload: T): void {
    if (!this.eventBus) return;
    try {
      this.eventBus.emit(channel, payload);
    } catch (err) {
      this.logger.debug(`emit ${channel} failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  private toView(s: LockState): LockStateView {
    return {
      accountId: s.accountId,
      slotId: s.slotId,
      tenantId: s.tenantId,
      userId: s.userId,
      userEmail: s.userEmail,
      acquiredAt: s.acquiredAt.toISOString(),
      lastActivityAt: s.lastActivityAt.toISOString(),
      socketCount: s.socketIds.size,
      idleMs: Date.now() - s.lastActivityAt.getTime(),
    };
  }
}

export interface LockStateView {
  accountId: number;
  slotId: number;
  tenantId: number;
  userId: string;
  userEmail: string;
  acquiredAt: string;
  lastActivityAt: string;
  socketCount: number;
  idleMs: number;
}

// 防止 TakeoverLockError 的 PERMISSION_DENIED 映成 500; controller 层转 Http
export function mapLockErrorToHttp(err: unknown): never {
  if (err instanceof TakeoverLockError) {
    if (err.code === 'PERMISSION_DENIED') throw new ForbiddenException(err.message);
    throw new BadRequestException(`${err.code}: ${err.message}`);
  }
  throw err;
}
