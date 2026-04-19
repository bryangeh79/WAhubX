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
import { BaileysService, type BindStatusView } from '../baileys/baileys.service';

@Controller({ path: 'slots', version: '1' })
export class SlotsController {
  constructor(
    private readonly slots: SlotsService,
    private readonly baileys: BaileysService,
  ) {}

  @Get()
  async list(@CurrentUser() cur: RequestUser): Promise<SlotResponseDto[]> {
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

  @Post(':id/clear')
  @HttpCode(HttpStatus.OK)
  async clear(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SlotResponseDto> {
    return this.slots.clear(id, cur.tenantId);
  }

  // ── M2 W1 扫码绑定现有号 (takeover) ────────────────────
  @Post(':id/bind-existing')
  @HttpCode(HttpStatus.OK)
  async startBind(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<BindStatusView> {
    // RBAC 先过一遍 findOne (租户隔离已做)
    await this.slots.findOne(id, cur.tenantId);
    return this.baileys.startBind(id);
  }

  @Get(':id/bind-existing/status')
  async bindStatus(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<BindStatusView> {
    await this.slots.findOne(id, cur.tenantId);
    return this.baileys.getStatus(id);
  }

  @Post(':id/bind-existing/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelBind(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<BindStatusView> {
    await this.slots.findOne(id, cur.tenantId);
    return this.baileys.cancelBind(id);
  }
}
