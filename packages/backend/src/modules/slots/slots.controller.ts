import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { SlotsService } from './slots.service';
import type { SlotResponseDto } from './dto/slot-response.dto';
import { SendTextMessageDto } from './dto/send-message.dto';
import { SendMediaMessageDto } from './dto/send-media.dto';
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

  // PATCH /slots/:id/proxy { proxyId: number | null } — 绑定/解绑代理
  // 切换会踢出现有 socket, 下次 bind/rehydrate 走新 agent
  @Patch(':id/proxy')
  @HttpCode(HttpStatus.OK)
  async assignProxy(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { proxyId: number | null },
  ): Promise<SlotResponseDto> {
    return this.slots.assignProxy(id, cur.tenantId, body?.proxyId ?? null);
  }

  // ── Bind 现有号 (M2 W1 扫码 / M2 W3 pairing code) ─────
  // Body { phoneNumber } 可选: 提供则走 pairing code 路径 (返 8 位码); 否则走 QR
  @Post(':id/bind-existing')
  @HttpCode(HttpStatus.OK)
  async startBind(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { phoneNumber?: string } = {},
  ): Promise<BindStatusView> {
    await this.slots.findOne(id, cur.tenantId);
    return this.baileys.startBind(id, body.phoneNumber);
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

  // ── 消息收发 (M2 W2) ──────────────────────────────────
  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  async sendText(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendTextMessageDto,
  ) {
    await this.slots.findOne(id, cur.tenantId);
    return this.baileys.sendText(id, dto.to, dto.text);
  }

  // W3: image/voice/file 发送, body 带 base64
  @Post(':id/send-media')
  @HttpCode(HttpStatus.OK)
  async sendMedia(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SendMediaMessageDto,
  ) {
    await this.slots.findOne(id, cur.tenantId);
    return this.baileys.sendMedia(id, dto.to, dto.type, dto.contentBase64, {
      mimeType: dto.mimeType,
      filename: dto.filename,
      caption: dto.caption,
    });
  }

  @Get(':id/contacts')
  async contacts(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const slot = await this.slots.findOne(id, cur.tenantId);
    if (!slot.accountId) return [];
    return this.baileys.listContacts(slot.accountId);
  }

  @Get(':id/messages')
  async messages(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Query('contactId', new DefaultValuePipe(0), ParseIntPipe) contactId: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('beforeId') beforeId?: string,
  ) {
    const slot = await this.slots.findOne(id, cur.tenantId);
    if (!slot.accountId) return [];
    return this.baileys.listMessages(slot.accountId, {
      contactId: contactId || undefined,
      limit,
      beforeId,
    });
  }

  @Get(':id/online-status')
  async onlineStatus(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ online: boolean }> {
    await this.slots.findOne(id, cur.tenantId);
    return { online: this.baileys.isInPool(id) };
  }
}
