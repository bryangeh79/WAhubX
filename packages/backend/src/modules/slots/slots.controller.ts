import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { SlotsService } from './slots.service';
import type { SlotResponseDto } from './dto/slot-response.dto';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';

@Controller({ path: 'slots', version: '1' })
export class SlotsController {
  constructor(private readonly slots: SlotsService) {}

  @Get()
  async list(@CurrentUser() cur: RequestUser): Promise<SlotResponseDto[]> {
    // 平台超管没租户, 不应该直接看"某租户"的槽位 (未来走 /admin/tenants/:id/slots)
    if (cur.tenantId === null) {
      throw new BadRequestException('平台超管请通过 /admin/tenants/:id/slots 访问具体租户槽位');
    }
    return this.slots.listForTenant(cur.tenantId);
  }

  @Get(':id')
  async findOne(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SlotResponseDto> {
    return this.slots.findOne(id, cur.tenantId);
  }

  // 清空槽位 (admin 或 operator 都能操作自己租户的槽位, viewer 不行 — 靠 role 守卫? 先简化: 都允许, 精细化留 M2)
  @Post(':id/clear')
  @HttpCode(HttpStatus.OK)
  async clear(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SlotResponseDto> {
    return this.slots.clear(id, cur.tenantId);
  }
}
