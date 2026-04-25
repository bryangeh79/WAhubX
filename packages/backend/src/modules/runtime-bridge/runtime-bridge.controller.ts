// 2026-04-25 · D8-2 · admin endpoint · 调试用 · 直接触发 runtime bind 流程
//
// 临时性 · D8-3 后 SlotsController.startBind 内部走这个 service · 用户走业务路径
// 不在 D8-2 范围: 鉴权 (现在 @Public · 任何人能调 · 仅限本机用)

import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { RuntimeBridgeService } from './runtime-bridge.service';

@Controller('admin/runtime')
export class RuntimeBridgeController {
  constructor(private readonly bridge: RuntimeBridgeService) {}

  @Public()
  @Get('connections')
  listConnections(): { slots: number[]; count: number } {
    const slots = this.bridge.getConnectedSlots();
    return { slots, count: slots.length };
  }

  @Public()
  @Get('state/:slotId')
  getState(@Param('slotId', ParseIntPipe) slotId: number): unknown {
    const cache = this.bridge.getCachedBindState(slotId);
    if (!cache) {
      return { connected: this.bridge.hasConnection(slotId), bindState: null };
    }
    return {
      connected: this.bridge.hasConnection(slotId),
      ...cache,
      // dataUrl 不在响应里 · 太大 · 单独 endpoint
      qrDataUrl: cache.qrDataUrl ? `[${cache.qrDataUrl.length} chars]` : null,
    };
  }

  @Public()
  @Get('qr/:slotId')
  async getQr(@Param('slotId', ParseIntPipe) slotId: number): Promise<{ qr: string | null; refreshCount: number }> {
    const cache = this.bridge.getCachedBindState(slotId);
    return {
      qr: cache?.qrDataUrl ?? null,
      refreshCount: cache?.qrRefreshCount ?? 0,
    };
  }

  @Public()
  @Post('start-bind/:slotId')
  async startBind(@Param('slotId', ParseIntPipe) slotId: number): Promise<unknown> {
    return this.bridge.startBind(slotId);
  }

  @Public()
  @Post('cancel-bind/:slotId')
  async cancelBind(@Param('slotId', ParseIntPipe) slotId: number): Promise<unknown> {
    return this.bridge.cancelBind(slotId);
  }

  @Public()
  @Post('fetch-status/:slotId')
  async fetchStatus(@Param('slotId', ParseIntPipe) slotId: number): Promise<unknown> {
    return this.bridge.fetchStatus(slotId);
  }
}
