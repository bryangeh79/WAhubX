// 2026-04-25 · D9-4 · SlotRuntimeRegistry · 选择实装 (Codex 边界 5)
// 2026-04-27 · D11.5 · 加 per-slot 路由 · 客服号永远 chromium · 其他号跟全局 env
//
// 范围 (锁定):
//   ✓ 按 slot.role 路由到 BaileysSlotRuntime / ChromiumSlotRuntime (新)
//   ✓ 老 current() / getCurrentMode() 保留作"无 slot 上下文"兜底
//   ✓ 暴露 ISlotRuntime 给 SlotsService
//   ✗ 不替换全部老 BaileysService 调用 (留 D10+)
//
// 业务模块 inject 后:
//   - 知道 slot 的场景: 调 runtimeFor(slot) 拿 per-slot runtime
//   - 不知道 slot 的场景 (e.g. 启动期日志): 调 current() 拿全局兜底
//
// 路由规则:
//   slot.role === customer_service → chromium (always-on · 接管 screencast 必需)
//   其他 (broadcast / unknown)     → 跟 RUNTIME_MODE env 全局 (默认 baileys)

import { Injectable, Logger } from '@nestjs/common';
import type { ISlotRuntime } from '@wahubx/shared';
import { AccountSlotEntity, AccountSlotRole } from '../slots/account-slot.entity';
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
      `SlotRuntimeRegistry initialized · 全局 mode=${mode} (env: ${process.env.RUNTIME_MODE ?? '(unset · default baileys)'}) · 客服号永远走 chromium`,
    );
  }

  // ═══════════════════════════════════════════════════════
  // D11.5 · per-slot 路由 (新 · 推荐用)
  // ═══════════════════════════════════════════════════════

  /**
   * 按 slot 决定走哪个 runtime
   * 客服号 (customer_service) → chromium (always-on · 接管 screencast 必需)
   * 其他号 (broadcast)        → 跟全局 env (默认 baileys · 节省内存)
   */
  getRuntimeFor(slot: AccountSlotEntity): 'baileys' | 'chromium' {
    if (slot.role === AccountSlotRole.CustomerService) return 'chromium';
    return this.getCurrentMode();
  }

  /**
   * 按 slot 拿 ISlotRuntime 实装
   * 调用方: const runtime = registry.runtimeFor(slot); await runtime.sendText(...)
   */
  runtimeFor(slot: AccountSlotEntity): ISlotRuntime {
    return this.getRuntimeFor(slot) === 'chromium' ? this.chromium : this.baileys;
  }

  // ═══════════════════════════════════════════════════════
  // 老接口 · 兜底 (无 slot 上下文 · e.g. 启动期日志 / 跨 slot 操作)
  // ═══════════════════════════════════════════════════════

  /**
   * 全局 runtime (兜底 · 不知道 slot 时用 · 默认按 env)
   * D11.5 后调用方应优先 runtimeFor(slot) · current() 留给确实无 slot 的场景
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
   * 全局 mode 字符串 · 诊断 / 启动日志用 · 不依赖 slot
   * D11.5 后调用方做 chromium guard 应用 getRuntimeFor(slot)
   */
  getCurrentMode(): 'baileys' | 'chromium' {
    return process.env.RUNTIME_MODE === 'chromium' ? 'chromium' : 'baileys';
  }
}
