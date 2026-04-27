// 2026-04-28 · Phase D · chromium-only · BaileysSlotRuntime 已删

import { Module } from '@nestjs/common';
import { RuntimeBridgeModule } from '../runtime-bridge/runtime-bridge.module';
import { RuntimeProcessModule } from '../runtime-process/runtime-process.module';
import { ChromiumSlotRuntime } from './chromium-slot-runtime';
import { SlotRuntimeRegistry } from './slot-runtime.registry';

@Module({
  imports: [RuntimeBridgeModule, RuntimeProcessModule],
  providers: [ChromiumSlotRuntime, SlotRuntimeRegistry],
  exports: [SlotRuntimeRegistry],
})
export class SlotRuntimeModule {}
