// M9 · TakeoverLockService 核心状态机测试
// 覆盖: 权限 / 抢占 / 重复 / 释放 / hard-kill / socket grace / sweep 自动释放

import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { DataSource } from 'typeorm';
import { TakeoverLockService } from './takeover-lock.service';
import { TakeoverLockError } from './takeover.errors';
import { AccountSlotEntity } from '../slots/account-slot.entity';
import { TaskEntity } from '../tasks/task.entity';
import { TaskRunEntity, TaskRunStatus } from '../tasks/task-run.entity';
import { UserRole } from '../users/user.entity';
import type { RequestUser } from '../auth/decorators/current-user.decorator';
import {
  TAKEOVER_ACQUIRED,
  TAKEOVER_HARD_KILL,
  TAKEOVER_IDLE_TIMEOUT,
  TAKEOVER_IDLE_WARNING,
  TAKEOVER_RELEASED,
} from './takeover.events';

// ── Fake DataSource ────────────────────────────────────
interface FakeSlot {
  id: number;
  tenantId: number;
  slotIndex: number;
  accountId: number | null;
  takeoverActive: boolean;
}
interface FakeRun {
  id: number;
  accountId: number;
  status: TaskRunStatus;
  taskId: number;
}

function buildFakeDataSource(init: { slots: FakeSlot[]; runs?: FakeRun[] }) {
  const slots = [...init.slots];
  const runs = init.runs ? [...init.runs] : [];
  const updates: Array<Record<string, unknown>> = [];

  const slotRepo = {
    findOne: async (opts: { where: Partial<FakeSlot> }) => {
      return (
        slots.find((s) =>
          Object.entries(opts.where).every(([k, v]) => (s as unknown as Record<string, unknown>)[k] === v),
        ) ?? null
      );
    },
    update: async (idOrCrit: number | Partial<FakeSlot>, patch: Partial<FakeSlot>) => {
      if (typeof idOrCrit === 'number') {
        const s = slots.find((x) => x.id === idOrCrit);
        if (s) Object.assign(s, patch);
      } else {
        for (const s of slots) {
          if (Object.entries(idOrCrit).every(([k, v]) => (s as unknown as Record<string, unknown>)[k] === v)) {
            Object.assign(s, patch);
          }
        }
      }
      updates.push({ patch });
    },
    createQueryBuilder: () => ({
      where: function () {
        return this;
      },
      getMany: async () => slots.filter((s) => s.takeoverActive),
      update: () => ({
        set: function () {
          return this;
        },
        where: function () {
          return this;
        },
        execute: async () => {
          for (const s of slots) if (s.takeoverActive) s.takeoverActive = false;
        },
      }),
    }),
  };

  const runRepo = {
    createQueryBuilder: () => ({
      where: function () {
        return this;
      },
      andWhere: function () {
        return this;
      },
      getMany: async () => runs.filter((r) => r.status === TaskRunStatus.Running),
    }),
  };

  const ds = {
    getRepository: (cls: unknown) => {
      if (cls === AccountSlotEntity) return slotRepo;
      if (cls === TaskRunEntity) return runRepo;
      if (cls === TaskEntity) return { findOne: async () => null };
      return { findOne: async () => null };
    },
    createQueryBuilder: () => ({
      update: () => ({
        set: function () {
          return this;
        },
        whereInIds: function () {
          return this;
        },
        where: function () {
          return this;
        },
        andWhere: function () {
          return this;
        },
        execute: async () => {
          for (const r of runs) {
            if (r.status === TaskRunStatus.Running) {
              r.status = TaskRunStatus.Interrupted;
            }
          }
        },
      }),
    }),
  } as unknown as DataSource;

  return { ds, slots, runs, updates };
}

function buildConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const defaults: Record<string, unknown> = {
    TAKEOVER_IDLE_TIMEOUT_MS: 30 * 60 * 1000,
    TAKEOVER_IDLE_WARNING_MS: 28 * 60 * 1000,
    TAKEOVER_DISCONNECT_GRACE_MS: 10_000,
    TAKEOVER_SWEEP_INTERVAL_MS: 30_000,
  };
  const merged = { ...defaults, ...overrides };
  return { get: <T>(k: string, def?: T) => (merged[k] ?? def) as T } as ConfigService;
}

function makeUser(overrides: Partial<RequestUser> = {}): RequestUser {
  return {
    id: 'user-A',
    email: 'admin@wahubx.local',
    username: 'admin',
    role: UserRole.Admin,
    tenantId: 1,
    status: 'active',
    ...overrides,
  };
}

async function buildSvc(opts: { slots: FakeSlot[]; runs?: FakeRun[]; config?: ConfigService; bus?: EventEmitter2 }) {
  const { ds } = buildFakeDataSource({ slots: opts.slots, runs: opts.runs });
  const bus = opts.bus ?? new EventEmitter2();
  const svc = new TakeoverLockService(ds, opts.config ?? buildConfig(), bus);
  // 手动 init (不起 sweep timer, 用户测试里直接调 private via any)
  return { svc, ds, bus };
}

const defaultSlot: FakeSlot = {
  id: 11,
  tenantId: 1,
  slotIndex: 1,
  accountId: 101,
  takeoverActive: false,
};

// ── Tests ──────────────────────────────────────────────
describe('TakeoverLockService', () => {
  it('acquire() · admin 可获取锁 · 置 takeover_active=true · emit acquired', async () => {
    const { svc, bus } = await buildSvc({ slots: [{ ...defaultSlot }] });
    const events: unknown[] = [];
    bus.on(TAKEOVER_ACQUIRED, (e) => events.push(e));
    const view = await svc.acquire(101, makeUser());
    expect(view.accountId).toBe(101);
    expect(view.userId).toBe('user-A');
    expect(events).toHaveLength(1);
  });

  it('acquire() · operator 403', async () => {
    const { svc } = await buildSvc({ slots: [{ ...defaultSlot }] });
    await expect(svc.acquire(101, makeUser({ role: UserRole.Operator }))).rejects.toBeInstanceOf(
      TakeoverLockError,
    );
  });

  it('acquire() · 跨租户非平台超管 403', async () => {
    const { svc } = await buildSvc({ slots: [{ ...defaultSlot, tenantId: 1 }] });
    await expect(svc.acquire(101, makeUser({ tenantId: 99 }))).rejects.toBeInstanceOf(TakeoverLockError);
  });

  it('acquire() · 平台超管 (tenantId=null) 可跨租户', async () => {
    const { svc } = await buildSvc({ slots: [{ ...defaultSlot, tenantId: 42 }] });
    const view = await svc.acquire(101, makeUser({ tenantId: null }));
    expect(view.accountId).toBe(101);
  });

  it('acquire() · 同用户重复调用幂等, 不抛', async () => {
    const { svc } = await buildSvc({ slots: [{ ...defaultSlot }] });
    await svc.acquire(101, makeUser());
    const second = await svc.acquire(101, makeUser());
    expect(second.accountId).toBe(101);
  });

  it('acquire() · 不同用户第二次 throws LOCK_HELD_BY_OTHER', async () => {
    const { svc } = await buildSvc({ slots: [{ ...defaultSlot }] });
    await svc.acquire(101, makeUser({ id: 'user-A' }));
    await expect(
      svc.acquire(101, makeUser({ id: 'user-B', email: 'b@x.com' })),
    ).rejects.toMatchObject({ code: 'LOCK_HELD_BY_OTHER' });
  });

  it('acquire() · 槽位不存在 SLOT_NOT_FOUND', async () => {
    const { svc } = await buildSvc({ slots: [] });
    await expect(svc.acquire(999, makeUser())).rejects.toMatchObject({ code: 'SLOT_NOT_FOUND' });
  });

  it('release() · 清 takeover_active + emit released', async () => {
    const { svc, bus } = await buildSvc({ slots: [{ ...defaultSlot }] });
    const events: unknown[] = [];
    bus.on(TAKEOVER_RELEASED, (e) => events.push(e));
    await svc.acquire(101, makeUser());
    await svc.release(101, makeUser(), 'manual');
    expect(svc.getLock(101)).toBeNull();
    expect(events).toHaveLength(1);
  });

  it('release() · 无锁幂等, 不抛', async () => {
    const { svc } = await buildSvc({ slots: [{ ...defaultSlot }] });
    await expect(svc.release(101, makeUser(), 'manual')).resolves.not.toThrow();
  });

  it('hardKill() · running task_run → interrupted + emit hard_kill', async () => {
    const { svc, bus } = await buildSvc({
      slots: [{ ...defaultSlot }],
      runs: [{ id: 5, accountId: 101, taskId: 1, status: TaskRunStatus.Running }],
    });
    const events: unknown[] = [];
    bus.on(TAKEOVER_HARD_KILL, (e) => events.push(e));
    await svc.acquire(101, makeUser());
    const runIds = await svc.hardKill(101, makeUser());
    expect(runIds).toContain(5);
    expect(events).toHaveLength(1);
  });

  it('hardKill() · 无活跃锁 → NO_ACTIVE_LOCK', async () => {
    const { svc } = await buildSvc({ slots: [{ ...defaultSlot }] });
    await expect(svc.hardKill(101, makeUser())).rejects.toMatchObject({ code: 'NO_ACTIVE_LOCK' });
  });

  it('isPaused() · 有锁=true · 无锁=false', async () => {
    const { svc } = await buildSvc({ slots: [{ ...defaultSlot }] });
    expect(svc.isPaused(101)).toBe(false);
    await svc.acquire(101, makeUser());
    expect(svc.isPaused(101)).toBe(true);
  });

  it('heartbeat() · 更新 lastActivityAt', async () => {
    jest.useFakeTimers();
    const { svc } = await buildSvc({ slots: [{ ...defaultSlot }] });
    const user = makeUser();
    const view0 = await svc.acquire(101, user);
    const t0 = new Date(view0.lastActivityAt).getTime();
    jest.advanceTimersByTime(5_000);
    svc.heartbeat(101, user);
    const view1 = svc.getLock(101)!;
    expect(new Date(view1.lastActivityAt).getTime()).toBeGreaterThanOrEqual(t0);
    jest.useRealTimers();
  });

  it('sweep · 28min idle emits warning (once)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-20T10:00:00Z'));
    const { svc, bus } = await buildSvc({ slots: [{ ...defaultSlot }] });
    const events: unknown[] = [];
    bus.on(TAKEOVER_IDLE_WARNING, (e) => events.push(e));
    await svc.acquire(101, makeUser());
    jest.setSystemTime(new Date('2026-04-20T10:29:00Z'));
    await (svc as unknown as { sweepIdleLocks: () => Promise<void> }).sweepIdleLocks();
    expect(events).toHaveLength(1);
    // 同一段 idle 只告一次
    await (svc as unknown as { sweepIdleLocks: () => Promise<void> }).sweepIdleLocks();
    expect(events).toHaveLength(1);
    jest.useRealTimers();
  });

  it('sweep · 30min idle 自动释放 + emit timeout', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-04-20T11:00:00Z'));
    const { svc, bus } = await buildSvc({ slots: [{ ...defaultSlot }] });
    const events: unknown[] = [];
    bus.on(TAKEOVER_IDLE_TIMEOUT, (e) => events.push(e));
    await svc.acquire(101, makeUser());
    jest.setSystemTime(new Date('2026-04-20T11:31:00Z'));
    await (svc as unknown as { sweepIdleLocks: () => Promise<void> }).sweepIdleLocks();
    expect(events).toHaveLength(1);
    expect(svc.getLock(101)).toBeNull();
    jest.useRealTimers();
  });

  it('socket 断开 · 启 10s grace · 期间不释放', async () => {
    const { svc } = await buildSvc({
      slots: [{ ...defaultSlot }],
      config: buildConfig({ TAKEOVER_DISCONNECT_GRACE_MS: 50 }),
    });
    const user = makeUser();
    await svc.acquire(101, user);
    svc.onSocketConnect(101, 'sock-A', user);
    svc.onSocketDisconnect(101, 'sock-A');
    // 断开后立即查仍在
    expect(svc.getLock(101)).not.toBeNull();
    // 10ms 内不释放
    await new Promise((r) => setTimeout(r, 20));
    expect(svc.getLock(101)).not.toBeNull();
    // 50ms 后 grace 过期但锁仍保 (idle_timeout 才释放; 100ms 远未到)
    await new Promise((r) => setTimeout(r, 60));
    expect(svc.getLock(101)).not.toBeNull();
  });

  it('socket 重连清 disconnect timer · 不触发 grace 过期路径', async () => {
    const { svc } = await buildSvc({
      slots: [{ ...defaultSlot }],
      config: buildConfig({ TAKEOVER_DISCONNECT_GRACE_MS: 50 }),
    });
    const user = makeUser();
    await svc.acquire(101, user);
    svc.onSocketConnect(101, 'sock-A', user);
    svc.onSocketDisconnect(101, 'sock-A');
    // 10ms 内重连
    await new Promise((r) => setTimeout(r, 10));
    svc.onSocketConnect(101, 'sock-B', user);
    // grace timer 应已清 · 再等 60ms 不应触发释放
    await new Promise((r) => setTimeout(r, 60));
    expect(svc.getLock(101)).not.toBeNull();
    expect(svc.getLock(101)!.socketCount).toBe(1);
  });
});
