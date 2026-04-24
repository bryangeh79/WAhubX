import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../executor.interface';
import { BaileysService } from '../../baileys/baileys.service';
import { AccountSlotEntity } from '../../slots/account-slot.entity';

// 2026-04-22 · 头像 / 签名低频更新 · 模拟真人会变
// payload: {
//   mode?: 'signature' | 'avatar' | 'both',
//   signatures?: string[],     // 可选签名池
//   avatarPaths?: string[],    // 可选头像文件绝对路径池
// }
@Injectable()
export class ProfileRefreshExecutor implements TaskExecutor {
  readonly taskType = 'profile_refresh';
  readonly allowedInNightWindow = true;

  private readonly logger = new Logger(ProfileRefreshExecutor.name);

  constructor(
    private readonly baileys: BaileysService,
    @InjectRepository(AccountSlotEntity)
    private readonly slotRepo: Repository<AccountSlotEntity>,
  ) {}

  async execute(ctx: TaskExecutorContext): Promise<TaskExecutorResult> {
    const payload = (ctx.task.payload ?? {}) as {
      mode?: 'signature' | 'avatar' | 'both';
      signatures?: string[];
      avatarPaths?: string[];
    };
    const mode = payload.mode ?? 'signature';
    const signatures = payload.signatures ?? [
      '🙂 日常',
      '😊 happy every day',
      'Stay positive 💪',
      '忙碌 · 但值得',
      'Live, laugh, love',
    ];

    const slot = await this.slotRepo.findOne({ where: { accountId: ctx.accountId } });
    if (!slot) return { success: false, errorCode: 'SLOT_NOT_FOUND', errorMessage: '槽位未找到' };
    const sock = this.baileys.getSocket(slot.id);
    if (!sock) return { success: false, errorCode: 'NOT_ONLINE', errorMessage: '槽位未在线' };

    let actions = 0;
    if (mode === 'signature' || mode === 'both') {
      const sig = signatures[Math.floor(Math.random() * signatures.length)];
      try {
        await sock.updateProfileStatus(sig);
        actions++;
        ctx.log('signature-updated', true, { sig });
      } catch (err) {
        ctx.log('signature-failed', false, {
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    // avatar 更新需要 sock.updateProfilePicture(jid, buffer) · 暂 V1 不自动 · 租户手填
    if ((mode === 'avatar' || mode === 'both') && payload.avatarPaths && payload.avatarPaths.length > 0) {
      ctx.log('avatar-skipped', true, { hint: 'V1 stub · 避免自动换头像触发风控' });
    }

    this.logger.log(`profile_refresh ${ctx.task.id} · slot ${slot.id} · actions=${actions}`);
    return { success: true, errorMessage: `更新资料 ${actions} 项` };
  }
}
