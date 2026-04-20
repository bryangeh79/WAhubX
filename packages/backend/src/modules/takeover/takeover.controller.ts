// M9 · 接管 API (§4.8)
//   POST   /takeover/:accountId/acquire    · 抢占接管锁
//   POST   /takeover/:accountId/release    · 释放锁
//   POST   /takeover/:accountId/hard-kill  · 强制中断正跑的 task_run (30s graceful 超时逃生口)
//   POST   /takeover/:accountId/heartbeat  · UI 心跳, 延长 idle timer
//   GET    /takeover/:accountId/status     · 查当前锁视图
//   GET    /takeover                        · 列所有活跃锁 (admin)

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/user.entity';
import { TakeoverLockService, type LockStateView } from './takeover-lock.service';
import { TakeoverLockError } from './takeover.errors';
import { AcquireTakeoverDto } from './dto/takeover.dto';

@Controller('takeover')
@UseGuards(RolesGuard)
@Roles(UserRole.Admin) // F 决策: operator/viewer 403
export class TakeoverController {
  constructor(private readonly lock: TakeoverLockService) {}

  @Post(':accountId/acquire')
  @HttpCode(200)
  async acquire(
    @Param('accountId', ParseIntPipe) accountId: number,
    @Body() _dto: AcquireTakeoverDto,
    @CurrentUser() user: RequestUser,
  ): Promise<LockStateView> {
    try {
      return await this.lock.acquire(accountId, user);
    } catch (err) {
      this.rethrow(err);
    }
  }

  @Post(':accountId/release')
  @HttpCode(204)
  async release(
    @Param('accountId', ParseIntPipe) accountId: number,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    try {
      await this.lock.release(accountId, user, 'manual');
    } catch (err) {
      this.rethrow(err);
    }
  }

  @Post(':accountId/hard-kill')
  @HttpCode(200)
  async hardKill(
    @Param('accountId', ParseIntPipe) accountId: number,
    @CurrentUser() user: RequestUser,
  ): Promise<{ interruptedRunIds: number[] }> {
    try {
      const ids = await this.lock.hardKill(accountId, user);
      return { interruptedRunIds: ids };
    } catch (err) {
      this.rethrow(err);
    }
  }

  @Post(':accountId/heartbeat')
  @HttpCode(204)
  async heartbeat(
    @Param('accountId', ParseIntPipe) accountId: number,
    @CurrentUser() user: RequestUser,
  ): Promise<void> {
    this.lock.heartbeat(accountId, user);
  }

  @Get(':accountId/status')
  status(@Param('accountId', ParseIntPipe) accountId: number): { lock: LockStateView | null } {
    return { lock: this.lock.getLock(accountId) };
  }

  @Get()
  list(): { locks: LockStateView[] } {
    return { locks: this.lock.listLocks() };
  }

  private rethrow(err: unknown): never {
    if (err instanceof TakeoverLockError) {
      if (err.code === 'PERMISSION_DENIED') throw new ForbiddenException(err.message);
      throw new BadRequestException(`${err.code}: ${err.message}`);
    }
    throw err;
  }
}
