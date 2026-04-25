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
import { BaileysService } from '../baileys/baileys.service';
import {
  SimInfoService,
  type UpdateSimInfoDto,
  type BulkUpdateItemDto,
} from './sim-info.service';
import { HandoverService } from './handover.service';
import { Res } from '@nestjs/common';
import type { Response } from 'express';

@Controller({ path: 'slots', version: '1' })
export class SlotsController {
  constructor(
    private readonly slots: SlotsService,
    private readonly baileys: BaileysService,
    private readonly simInfo: SimInfoService,
    private readonly handover: HandoverService,
  ) {}

  // ── 转出手机 · 导出备份 (2026-04-22) ──────────────────────
  @Get(':id/export/contacts.csv')
  async exportContacts(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const csv = await this.handover.exportContactsCsv(id, cur.tenantId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="slot-${id}-contacts.csv"`);
    res.send(csv);
  }

  @Get(':id/export/channels-groups.txt')
  async exportChannelsGroups(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const txt = await this.handover.exportChannelsAndGroupsTxt(id, cur.tenantId);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="slot-${id}-channels-groups.txt"`);
    res.send(txt);
  }

  @Get(':id/export/chats.txt')
  async exportChats(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const txt = await this.handover.exportChatsTxt(id, cur.tenantId);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="slot-${id}-chats.txt"`);
    res.send(txt);
  }

  // ── SIM 信息 (2026-04-22) ─────────────────────────────────
  // GET /slots/sim-info/telco-registry · 前端初始化下拉
  // 注: 路径故意加 "sim-info/" 前缀避免和 @Get(':id') 冲突
  @Get('sim-info/telco-registry')
  getTelcoRegistry() {
    return this.simInfo.getTelcoRegistry();
  }

  // PATCH /slots/:id/sim-info · 单槽位更新
  @Patch(':id/sim-info')
  @HttpCode(HttpStatus.OK)
  async updateSimInfo(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateSimInfoDto,
  ): Promise<SlotResponseDto> {
    await this.simInfo.updateForSlot(id, cur.tenantId, body);
    return this.slots.findOne(id, cur.tenantId);
  }

  // POST /slots/sim-info/bulk · 批量 · body 是 item 数组
  @Post('sim-info/bulk')
  @HttpCode(HttpStatus.OK)
  async bulkSimInfo(
    @CurrentUser() cur: RequestUser,
    @Body() body: { items: BulkUpdateItemDto[] },
  ) {
    if (!Array.isArray(body?.items) || body.items.length === 0) {
      throw new BadRequestException('items 必须是非空数组');
    }
    return this.simInfo.bulkUpdate(body.items, cur.tenantId);
  }

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

  // POST /slots/backfill-fingerprints — 一次性回填老数据的 fingerprint.json + DB
  // 幂等: 已存在文件/字段的不动, 只补 null 的
  @Post('backfill-fingerprints')
  @HttpCode(HttpStatus.OK)
  async backfillFingerprints(@CurrentUser() cur: RequestUser) {
    if (cur.tenantId === null) {
      throw new BadRequestException('平台超管需指定租户 — 当前只支持租户 admin 自行回填');
    }
    return this.slots.backfillFingerprintsForTenant(cur.tenantId);
  }

  // ── Bind 现有号 (M2 W1 扫码 / M2 W3 pairing code) ─────
  // Body { phoneNumber } 可选: 提供则走 pairing code 路径 (返 8 位码); 否则走 QR
  @Post(':id/bind-existing')
  @HttpCode(HttpStatus.OK)
  async startBind(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { phoneNumber?: string } = {},
  ): Promise<unknown> {
    // 2026-04-25 · D8-3 · 通过 SlotsService facade · RUNTIME_MODE 切 chromium 时走 RuntimeBridge
    await this.slots.findOne(id, cur.tenantId);
    return this.slots.bindStartBind(id, body.phoneNumber);
  }

  @Get(':id/bind-existing/status')
  async bindStatus(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<unknown> {
    // 2026-04-25 · D8-3 · facade · chromium runtime 直接返 backend 缓存
    await this.slots.findOne(id, cur.tenantId);
    return this.slots.bindGetStatus(id);
  }

  @Post(':id/bind-existing/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelBind(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<unknown> {
    // 2026-04-25 · D8-3 · facade · 走 SlotsService 而非直接 BaileysService
    await this.slots.findOne(id, cur.tenantId);
    return this.slots.bindCancelBind(id);
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

  // 2026-04-22 · 被封槽位手动重连 · 租户 UI 点按钮调
  // 1. 校验槽位属于租户 + 状态是 suspended
  // 2. 重置 DB status 到 active
  // 3. rehydrate pool (触发新一轮 Baileys 连接)
  @Post(':id/reconnect')
  @HttpCode(HttpStatus.OK)
  async reconnect(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ ok: boolean; message: string }> {
    const slot = await this.slots.findOne(id, cur.tenantId);
    if (!slot.accountId) {
      throw new BadRequestException('槽位未绑号 · 无法重连');
    }
    // DB 置 active · 让后续 rehydrate 能跑 (markSlotSuspended 的逆操作)
    try {
      await this.baileys.evictFromPool(id); // 先踢 · 清残留
      await this.slots.findOne(id, cur.tenantId); // 确认还在
      // 直接 update (通过内部方法暴露)
      await this.baileys.reactivateAndRespawn(id);
      return {
        ok: true,
        message: '已触发重连 · 请等 30 秒查看状态. 若仍封禁 · 点"诊断"看原因.',
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // 2026-04-22 · 连接诊断 · 给租户看为什么封 · 给建议
  @Get(':id/connection-diagnosis')
  async diagnosis(
    @CurrentUser() cur: RequestUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const slot = await this.slots.findOne(id, cur.tenantId);
    return this.baileys.getConnectionDiagnosis(id, slot);
  }
}
