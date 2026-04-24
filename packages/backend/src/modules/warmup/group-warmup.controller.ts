import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { GroupWarmupService } from './group-warmup.service';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';

// 2026-04-22 · Group-based 养号计划 REST
@Controller({ path: 'group-warmup', version: '1' })
export class GroupWarmupController {
  constructor(private readonly svc: GroupWarmupService) {}

  @Get()
  async list(@CurrentUser() cur: RequestUser) {
    return this.svc.listForTenant(cur.tenantId);
  }

  // POST /group-warmup/start { groupId, template? }
  @Post('start')
  @HttpCode(HttpStatus.OK)
  async start(
    @CurrentUser() cur: RequestUser,
    @Body() body: { groupId: number; template?: string },
  ) {
    if (!body?.groupId) throw new BadRequestException('groupId 必填');
    return this.svc.start(body.groupId, cur.tenantId, body.template ?? 'v1_7day');
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  async pause(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.svc.pause(id, cur.tenantId);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  async resume(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.svc.resume(id, cur.tenantId);
  }

  // 2026-04-22 · Day 15+ 开启成熟运营 · 3 档
  @Post(':id/start-mature')
  @HttpCode(HttpStatus.OK)
  async startMature(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { level: 'light' | 'standard' | 'aggressive' },
  ) {
    if (!body?.level) throw new BadRequestException('level 必填');
    if (!['light', 'standard', 'aggressive'].includes(body.level)) {
      throw new BadRequestException('level 只能是 light/standard/aggressive');
    }
    return this.svc.startMature(id, cur.tenantId, body.level);
  }

  @Post(':id/stop-mature')
  @HttpCode(HttpStatus.OK)
  async stopMature(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.svc.stopMature(id, cur.tenantId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async stop(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.svc.stop(id, cur.tenantId);
  }
}
