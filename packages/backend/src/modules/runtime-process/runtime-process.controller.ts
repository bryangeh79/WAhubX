// 2026-04-25 · D12-2 · admin endpoint · 调试用 · per-slot 进程管理
//
// ⚠ 临时 (D14 删 · 跟 admin/runtime 一样) · 未鉴权 · 仅本机用
// 用户路径 D12-3 才会接到 SlotsService

import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { RuntimeProcessManagerService } from './runtime-process-manager.service';
import type { ProcessState } from './process-state';

@Controller('admin/runtime-process')
export class RuntimeProcessController {
  constructor(private readonly mgr: RuntimeProcessManagerService) {}

  @Public()
  @Get('all')
  listAll(): { count: number; processes: ProcessState[] } {
    const processes = this.mgr.listAll();
    return { count: processes.length, processes };
  }

  @Public()
  @Get('status/:slotId')
  status(@Param('slotId', ParseIntPipe) slotId: number): ProcessState {
    return this.mgr.getProcessState(slotId);
  }

  @Public()
  @Post('start/:slotId')
  async start(@Param('slotId', ParseIntPipe) slotId: number): Promise<ProcessState> {
    return this.mgr.start(slotId);
  }

  @Public()
  @Post('stop/:slotId')
  async stop(@Param('slotId', ParseIntPipe) slotId: number): Promise<ProcessState> {
    return this.mgr.stop(slotId, { graceful: true, timeoutMs: 10_000 });
  }

  @Public()
  @Post('kill/:slotId')
  async kill(@Param('slotId', ParseIntPipe) slotId: number): Promise<ProcessState> {
    return this.mgr.stop(slotId, { graceful: false });
  }

  // 2026-04-25 · D12-3 · 手动触发 auto-spawn 扫描 (调试用)
  @Public()
  @Post('auto-spawn')
  async autoSpawn(): Promise<{ scanned: number; eligible: number; started: number }> {
    return this.mgr.triggerAutoSpawn();
  }
}
