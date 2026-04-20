import { Injectable, Logger } from '@nestjs/common';
import type { TaskExecutor, TaskExecutorContext, TaskExecutorResult } from '../executor.interface';

// M3 stub: payload 最小结构 { to: string, text: string }, 调用 sendText (M2 已实装).
// M4 剧本引擎会发更丰富的 payload (剧本 id, 步骤 index 等).
@Injectable()
export class ChatExecutor implements TaskExecutor {
  readonly taskType = 'chat';
  readonly allowedInNightWindow = false; // 夜间不放 (按技术交接文档 § 5.2)

  private readonly logger = new Logger(ChatExecutor.name);

  async execute(ctx: TaskExecutorContext): Promise<TaskExecutorResult> {
    const payload = (ctx.task.payload ?? {}) as { to?: string; text?: string };
    if (!payload.to || !payload.text) {
      return {
        success: false,
        errorCode: 'INVALID_PAYLOAD',
        errorMessage: 'chat task payload 需要 { to, text } 两个字段',
      };
    }
    this.logger.log(`chat task ${ctx.task.id} on account ${ctx.accountId} → ${payload.to} (stub M3)`);
    ctx.log('chat-prepared', true, { to: payload.to, textLen: payload.text.length });
    // M9 · 接管抢占 breakpoint · 若已被接管, throw TaskPausedError · dispatcher 标 paused 不扣分
    ctx.throwIfPaused?.();
    // M3 stub: 不真调 Baileys, 留给 M4 剧本引擎把 sendText 接进 ctx
    // M4 会在 ctx 里注入 BaileysService.sendText 的绑定, 避免 executor 直接耦合业务服务
    await new Promise((r) => setTimeout(r, 300));
    ctx.throwIfPaused?.();
    ctx.log('chat-sent', true, {});
    return { success: true };
  }
}
