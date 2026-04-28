// 2026-04-28 · Phase D · chromium-only · BaileysSlotRuntime 已删
// 保留 per-slot 路由 API 以兼容老调用点 · 全部归一返 ChromiumSlotRuntime

import { Injectable, Logger } from '@nestjs/common';
import type { ISlotRuntime } from '@wahubx/shared';
import { AccountSlotEntity } from '../slots/account-slot.entity';
import { ChromiumSlotRuntime } from './chromium-slot-runtime';

@Injectable()
export class SlotRuntimeRegistry {
  private readonly logger = new Logger(SlotRuntimeRegistry.name);

  constructor(private readonly chromium: ChromiumSlotRuntime) {
    this.logger.log('SlotRuntimeRegistry · chromium-only (Phase D · baileys 已拔)');
  }

  /** 历史 API · 永久返 'chromium' (Phase D 后唯一 runtime) */
  getRuntimeFor(_slot: AccountSlotEntity): 'chromium' {
    return 'chromium';
  }

  runtimeFor(_slot: AccountSlotEntity): ISlotRuntime {
    return this.chromium;
  }

  current(): ISlotRuntime {
    return this.chromium;
  }

  getCurrentMode(): 'chromium' {
    return 'chromium';
  }
}
