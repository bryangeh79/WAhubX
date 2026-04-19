// 收工硬标准: 5 rejection paths + 夜间窗口 + unknown task_type 必须全绿 (用户 2026-04-19 立).
// 只测纯决策函数 decide() — buildContext + startRun 属集成测试, 由 smoke 覆盖.
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
import { DispatcherService, type DispatchContext } from './dispatcher.service';
import { ExecutorRegistry } from './executor-registry.service';
import type { TaskExecutor } from './executor.interface';
import { TaskEntity, TaskStatus, TaskTargetType } from './task.entity';
import { AccountSlotEntity, AccountSlotStatus } from '../slots/account-slot.entity';
import { WaAccountEntity, WarmupStage } from '../slots/wa-account.entity';

// ── fakes ────────────────────────────────────────────────
const fakeChatExecutor: TaskExecutor = {
  taskType: 'chat',
  allowedInNightWindow: false,
  execute: async () => ({ success: true }),
};
const fakeWarmupExecutor: TaskExecutor = {
  taskType: 'warmup',
  allowedInNightWindow: true,
  execute: async () => ({ success: true }),
};

function buildRegistry(): ExecutorRegistry {
  return new ExecutorRegistry([fakeChatExecutor, fakeWarmupExecutor] as unknown as TaskExecutor[]);
}

function buildConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const defaults: Record<string, unknown> = {
    SCHEDULER_MAX_CONCURRENCY: 6,
    SCHEDULER_POLL_INTERVAL_MS: 3000,
    SCHEDULER_NIGHT_WINDOW_START: '02:00',
    SCHEDULER_NIGHT_WINDOW_END: '06:00',
  };
  const merged = { ...defaults, ...overrides };
  return {
    get: <T>(key: string, def?: T): T => (merged[key] ?? def) as T,
  } as ConfigService;
}

function buildFakeDataSource(opts: {
  slot?: Partial<AccountSlotEntity> | null;
  wa?: Partial<WaAccountEntity> | null;
}) {
  // 区分 "key 未提供" (用 default) 和 "显式 null" (返 null, 测 ghost 账号路径)
  const slot = 'slot' in opts
    ? opts.slot
    : {
        id: 1,
        tenantId: 1,
        slotIndex: 1,
        accountId: 1,
        status: AccountSlotStatus.Active,
        proxyId: null,
        takeoverActive: false,
      };
  const wa = 'wa' in opts ? opts.wa : { id: 1, warmupStage: WarmupStage.Active };

  return {
    getRepository: (cls: unknown) => {
      if (cls === AccountSlotEntity) {
        return {
          findOne: async () => (slot === null ? null : slot as AccountSlotEntity),
        };
      }
      if (cls === WaAccountEntity) {
        return {
          findOne: async () => (wa === null ? null : wa as WaAccountEntity),
        };
      }
      return { findOne: async () => null };
    },
  } as unknown as DataSource;
}

function buildCtx(overrides: Partial<DispatchContext> = {}): DispatchContext {
  return {
    now: new Date('2026-04-19T14:00:00Z'), // 非夜间
    runningAccountIds: new Set(),
    runningProxyIds: new Set(),
    runningCount: 0,
    maxConcurrency: 6,
    ...overrides,
  };
}

function buildTask(overrides: Partial<TaskEntity> = {}): TaskEntity {
  return {
    id: 100,
    tenantId: 1,
    taskType: 'chat',
    priority: 5,
    scheduledAt: null,
    repeatRule: null,
    targetType: TaskTargetType.Account,
    targetIds: [1],
    payload: { to: '60111', text: 'hi' },
    status: TaskStatus.Pending,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as TaskEntity;
}

// ── tests ────────────────────────────────────────────────
describe('DispatcherService.decide', () => {
  let registry: ExecutorRegistry;
  let config: ConfigService;

  beforeEach(() => {
    registry = buildRegistry();
    config = buildConfig();
  });

  it('runs a normal chat task when context is clean', async () => {
    const ds = buildFakeDataSource({});
    const svc = new DispatcherService(ds, config, registry);
    const decision = await svc.decide(buildTask(), buildCtx());
    expect(decision).toEqual({ action: 'run', accountId: 1 });
  });

  // rejection #1
  it('skips when global running count >= max concurrency', async () => {
    const ds = buildFakeDataSource({});
    const svc = new DispatcherService(ds, config, registry);
    const ctx = buildCtx({ runningCount: 6, maxConcurrency: 6 });
    const decision = await svc.decide(buildTask(), ctx);
    expect(decision).toEqual({ action: 'skip-global-capacity' });
  });

  // rejection #2
  it('skips when the target account already has a task running', async () => {
    const ds = buildFakeDataSource({});
    const svc = new DispatcherService(ds, config, registry);
    const ctx = buildCtx({ runningAccountIds: new Set([1]) });
    const decision = await svc.decide(buildTask(), ctx);
    expect(decision).toEqual({ action: 'skip-account-busy' });
  });

  // rejection #3 (proxy group 有人在跑)
  it('skips when account proxy group already has a running task', async () => {
    const ds = buildFakeDataSource({ slot: { id: 1, tenantId: 1, slotIndex: 1, accountId: 1, status: AccountSlotStatus.Active, proxyId: 7, takeoverActive: false } });
    const svc = new DispatcherService(ds, config, registry);
    const ctx = buildCtx({ runningProxyIds: new Set([7]) });
    const decision = await svc.decide(buildTask(), ctx);
    expect(decision).toEqual({ action: 'skip-ip-group-busy' });
  });

  it('skips when proxy_id=null and null-group is busy (dev direct 场景)', async () => {
    const ds = buildFakeDataSource({ slot: { id: 1, tenantId: 1, slotIndex: 1, accountId: 1, status: AccountSlotStatus.Active, proxyId: null, takeoverActive: false } });
    const svc = new DispatcherService(ds, config, registry);
    const ctx = buildCtx({ runningProxyIds: new Set([-1]) });
    const decision = await svc.decide(buildTask(), ctx);
    expect(decision).toEqual({ action: 'skip-ip-group-busy' });
  });

  // rejection #4
  it('skips when slot is under manual takeover', async () => {
    const ds = buildFakeDataSource({ slot: { id: 1, tenantId: 1, slotIndex: 1, accountId: 1, status: AccountSlotStatus.Active, proxyId: null, takeoverActive: true } });
    const svc = new DispatcherService(ds, config, registry);
    const decision = await svc.decide(buildTask(), buildCtx());
    expect(decision).toEqual({ action: 'skip-takeover-active' });
  });

  // rejection #5 — soft: allowed to run, just warn
  it('soft-warns but still runs when warmup_stage < required', async () => {
    const ds = buildFakeDataSource({
      slot: { id: 1, tenantId: 1, slotIndex: 1, accountId: 1, status: AccountSlotStatus.Active, proxyId: null, takeoverActive: false },
      wa: { id: 1, warmupStage: WarmupStage.Incubation }, // chat 需 Prewarm, 当前 Incubation 不够
    });
    const svc = new DispatcherService(ds, config, registry);
    // chat 任务 + 账号只 Incubation → soft warn 但返 run
    const decision = await svc.decide(buildTask({ taskType: 'chat' }), buildCtx());
    expect(decision).toEqual({ action: 'run', accountId: 1 });
  });

  // night window
  it('blocks chat task in night window (02:00-06:00)', async () => {
    const ds = buildFakeDataSource({});
    const svc = new DispatcherService(ds, config, registry);
    const nightNow = new Date('2026-04-19T03:00:00'); // 本地 03:00
    const decision = await svc.decide(buildTask({ taskType: 'chat' }), buildCtx({ now: nightNow }), nightNow);
    expect(decision).toEqual({ action: 'skip-night-window' });
  });

  it('allows warmup task in night window', async () => {
    const ds = buildFakeDataSource({});
    const svc = new DispatcherService(ds, config, registry);
    const nightNow = new Date('2026-04-19T03:00:00');
    const decision = await svc.decide(buildTask({ taskType: 'warmup' }), buildCtx({ now: nightNow }), nightNow);
    expect(decision).toEqual({ action: 'run', accountId: 1 });
  });

  // unknown task type → leave pending + warn (用户 2A 约束)
  it('leaves unknown task_type pending instead of rejecting (registry未注册)', async () => {
    const ds = buildFakeDataSource({});
    const svc = new DispatcherService(ds, config, registry);
    const decision = await svc.decide(buildTask({ taskType: 'mystery_not_registered' }), buildCtx());
    expect(decision).toEqual({ action: 'leave-pending-unknown-type' });
  });

  // 边界: target_type=group M3 尚未支持, 按 unknown 处理保 pending
  it('leaves group-target task pending until M4 group support is added', async () => {
    const ds = buildFakeDataSource({});
    const svc = new DispatcherService(ds, config, registry);
    const decision = await svc.decide(
      buildTask({ targetType: TaskTargetType.Group, targetIds: [5] }),
      buildCtx(),
    );
    expect(decision).toEqual({ action: 'leave-pending-unknown-type' });
  });

  // 边界: target account 不存在 (slot 查不到) → 保 pending 让人工排查
  it('leaves pending when account slot not found (ghost account)', async () => {
    const ds = buildFakeDataSource({ slot: null });
    const svc = new DispatcherService(ds, config, registry);
    const decision = await svc.decide(buildTask(), buildCtx());
    expect(decision).toEqual({ action: 'leave-pending-unknown-type' });
  });
});

describe('DispatcherService.isInNightWindow', () => {
  let registry: ExecutorRegistry;

  beforeEach(() => {
    registry = buildRegistry();
  });

  it('returns true at 02:00 and 05:59 (inclusive start, exclusive end)', () => {
    const svc = new DispatcherService(
      buildFakeDataSource({}),
      buildConfig(),
      registry,
    );
    expect(svc.isInNightWindow(new Date('2026-04-19T02:00:00'))).toBe(true);
    expect(svc.isInNightWindow(new Date('2026-04-19T05:59:59'))).toBe(true);
  });

  it('returns false at 06:00 (exclusive end) and at day', () => {
    const svc = new DispatcherService(buildFakeDataSource({}), buildConfig(), registry);
    expect(svc.isInNightWindow(new Date('2026-04-19T06:00:00'))).toBe(false);
    expect(svc.isInNightWindow(new Date('2026-04-19T14:00:00'))).toBe(false);
  });

  it('supports cross-midnight windows (22:00 → 04:00)', () => {
    const svc = new DispatcherService(
      buildFakeDataSource({}),
      buildConfig({ SCHEDULER_NIGHT_WINDOW_START: '22:00', SCHEDULER_NIGHT_WINDOW_END: '04:00' }),
      registry,
    );
    expect(svc.isInNightWindow(new Date('2026-04-19T22:30:00'))).toBe(true);
    expect(svc.isInNightWindow(new Date('2026-04-19T03:00:00'))).toBe(true);
    expect(svc.isInNightWindow(new Date('2026-04-19T05:00:00'))).toBe(false);
  });
});

describe('ExecutorRegistry', () => {
  it('throws on duplicate taskType registration', () => {
    expect(() =>
      new ExecutorRegistry([fakeChatExecutor, fakeChatExecutor] as unknown as TaskExecutor[]),
    ).toThrow(/Duplicate executor/);
  });

  it('returns null for unregistered taskType (no throw)', () => {
    const r = buildRegistry();
    expect(r.get('mystery')).toBeNull();
    expect(r.has('mystery')).toBe(false);
    expect(r.isAllowedInNightWindow('mystery')).toBe(false);
  });
});
