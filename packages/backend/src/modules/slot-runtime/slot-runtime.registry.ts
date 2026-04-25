// 2026-04-25 · D9-4 · SlotRuntimeRegistry · 选择实装 (Codex 边界 5)
//
// 范围 (锁定):
//   ✓ 按 RUNTIME_MODE env 路由到 BaileysSlotRuntime / ChromiumSlotRuntime
//   ✓ 暴露 ISlotRuntime 给 SlotsService
//   ✗ 不替换全部老 BaileysService 调用 (留 D10+)
//
// 业务模块只需 inject SlotRuntimeRegistry · 调 .current() 拿当前 runtime ·
// 不 care 是 baileys 还是 chromium.

import { Injectable, Logger } from '@nestjs/common';
import type { ISlotRuntime } from '@wahubx/shared';
import { BaileysSlotRuntime } from './baileys-slot-runtime';
import { ChromiumSlotRuntime } from './chromium-slot-runtime';

@Injectable()
export class SlotRuntimeRegistry {
  private readonly logger = new Logger(SlotRuntimeRegistry.name);

  constructor(
    private readonly baileys: BaileysSlotRuntime,
    private readonly chromium: ChromiumSlotRuntime,
  ) {
    const mode = this.getCurrentMode();
    this.logger.log(
      `SlotRuntimeRegistry initialized · RUNTIME_MODE=${mode} (env: ${process.env.RUNTIME_MODE ?? '(unset · default baileys)'})`,
    );
  }

  /**
   * 当前选用的 runtime 实装
   * 调用方拿这个 · 直接调 ISlotRuntime 方法
   */
  current(): ISlotRuntime {
    return this.getCurrentMode() === 'chromium' ? this.chromium : this.baileys;
  }

  /**
   * 强制返 baileys (用于过渡期某些路径必须老路径 · 比如 newsletter / group 等不在接口内的 API)
   */
  legacyBaileys(): BaileysSlotRuntime {
    return this.baileys;
  }

  /**
   * 当前 mode 字符串 (诊断用)
   */
  getCurrentMode(): 'baileys' | 'chromium' {
    return process.env.RUNTIME_MODE === 'chromium' ? 'chromium' : 'baileys';
  }
}
