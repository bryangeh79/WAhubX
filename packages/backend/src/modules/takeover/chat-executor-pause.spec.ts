// M9 · Chat Executor 接管抢占 breakpoint 测试
// 验证 ctx.throwIfPaused() hook 在 ctx 来自 dispatcher 时生效

import { ChatExecutor } from '../tasks/executors/chat.executor';
import { TaskPausedError } from './takeover.errors';
import type { TaskExecutorContext } from '../tasks/executor.interface';
import { TaskEntity, TaskStatus, TaskTargetType } from '../tasks/task.entity';
import type { SlotsService } from '../slots/slots.service';
import type { Repository } from 'typeorm';
import type { AccountSlotEntity } from '../slots/account-slot.entity';

// 2026-04-26 · R9-bis · ChatExecutor constructor 现在需 (slots, slotRepo)
const stubSlots = {
  sendText: async () => ({ waMessageId: null }),
} as unknown as SlotsService;
const stubSlotRepo = {
  findOne: async () => ({ id: 1, accountId: 101 } as AccountSlotEntity),
} as unknown as Repository<AccountSlotEntity>;

function buildTask(payload: Record<string, unknown> = { to: '60123456789', text: 'hi' }): TaskEntity {
  return {
    id: 1,
    tenantId: 1,
    taskType: 'chat',
    priority: 5,
    scheduledAt: null,
    repeatRule: null,
    targetType: TaskTargetType.Account,
    targetIds: [101],
    payload,
    status: TaskStatus.Pending,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    pausedAt: null,
  };
}

function buildCtx(overrides: Partial<TaskExecutorContext>): TaskExecutorContext {
  return {
    task: buildTask(),
    accountId: 101,
    log: () => undefined,
    ...overrides,
  };
}

describe('ChatExecutor · takeover pause hook', () => {
  it('正常路径: isPaused=false 不抛, return success', async () => {
    const exec = new ChatExecutor(stubSlots, stubSlotRepo);
    let throws = 0;
    const ctx = buildCtx({
      isPaused: () => false,
      throwIfPaused: () => {
        throws++;
      },
    });
    const result = await exec.execute(ctx);
    expect(result.success).toBe(true);
    expect(throws).toBe(2); // 2 个 breakpoint, 都 no-op
  });

  it('接管路径: throwIfPaused 第 1 个 breakpoint 抛 TaskPausedError · executor 中止', async () => {
    const exec = new ChatExecutor(stubSlots, stubSlotRepo);
    const ctx = buildCtx({
      isPaused: () => true,
      throwIfPaused: () => {
        throw new TaskPausedError(101);
      },
    });
    await expect(exec.execute(ctx)).rejects.toBeInstanceOf(TaskPausedError);
  });
});
