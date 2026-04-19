import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../executor.interface';
import { AccountSlotEntity } from '../../slots/account-slot.entity';
import { WaAccountEntity } from '../../slots/wa-account.entity';

// warmup 执行器 · M5 实装 (从 M3 stub 升级).
// 作用: 日历里的"挂载 Xmin"窗口任务 — 保账号在线 presence, 不主动发消息.
// 实作: 验证 slot 在 baileys pool 中存在, 更新 last_online_at, 日志记录窗口占用.
// 真实 TTL 挂载 (让进程活 30min) 不在 executor 层做 —— baileys socket 本来就常驻, 不需要额外 keep-alive.
@Injectable()
export class WarmupExecutor implements TaskExecutor {
  readonly taskType = 'warmup';
  readonly allowedInNightWindow = true; // 夜间允许 (技术交接文档 § 5.2)

  constructor(
    @InjectRepository(AccountSlotEntity) private readonly slotRepo: Repository<AccountSlotEntity>,
    @InjectRepository(WaAccountEntity) private readonly accountRepo: Repository<WaAccountEntity>,
  ) {}

  async execute(ctx: TaskExecutorContext): Promise<TaskExecutorResult> {
    const payload = (ctx.task.payload ?? {}) as { _durationMin?: number; _windowAt?: string };

    const slot = await this.slotRepo.findOne({ where: { accountId: ctx.accountId } });
    if (!slot) {
      return { success: false, errorCode: 'NO_SLOT', errorMessage: `account ${ctx.accountId} 无 slot` };
    }

    // presence marker — 账号 last_online_at 更新. Baileys socket 常驻本来就在线.
    await this.accountRepo.update({ id: ctx.accountId }, { lastOnlineAt: new Date() });
    ctx.log('warmup-presence', true, {
      slotId: slot.id,
      accountId: ctx.accountId,
      windowAt: payload._windowAt,
      durationMin: payload._durationMin,
    });
    return { success: true };
  }
}
