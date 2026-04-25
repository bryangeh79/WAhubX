// 2026-04-25 · D9-4 · SlotRuntimeModule
//
// 把 BaileysSlotRuntime / ChromiumSlotRuntime / SlotRuntimeRegistry 集中导出
// 业务模块 (SlotsModule etc) 只 import 这一个

import { forwardRef, Module } from '@nestjs/common';
import { BaileysModule } from '../baileys/baileys.module';
import { RuntimeBridgeModule } from '../runtime-bridge/runtime-bridge.module';
import { BaileysSlotRuntime } from './baileys-slot-runtime';
import { ChromiumSlotRuntime } from './chromium-slot-runtime';
import { SlotRuntimeRegistry } from './slot-runtime.registry';

@Module({
  imports: [forwardRef(() => BaileysModule), RuntimeBridgeModule],
  providers: [BaileysSlotRuntime, ChromiumSlotRuntime, SlotRuntimeRegistry],
  exports: [SlotRuntimeRegistry],
})
export class SlotRuntimeModule {}
