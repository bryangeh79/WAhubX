// 2026-04-25 · D8-2 · admin endpoint · 调试用 · 直接触发 runtime bind 流程
//
// ⚠ 临时调试接口 · D14 必须删除 (Codex 锁定 · 不带进交付版)
//
// 用户/前端 (BindExistingModal 等) 必须走 /slots/:id/bind-existing/* ·
// 那条路径会经 SlotsService.findOne 做租户校验 · 这条路径无校验 · 任何人能调.
//
// 当前用途:
//   - D8-2/D8-3 调试 · 验 RuntimeBridge 行为
//   - 本机 dev 时手动触发 bind (curl/postman)
//
// D14 删除条件:
//   - SlotsController.startBind 已通过 SlotsService.bindStartBind 走 RuntimeBridge
//   - frontend BindExistingModal 已对接正式响应字段
//   - 没有任何代码引用 /admin/runtime/*

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
