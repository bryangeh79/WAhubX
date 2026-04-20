// M9 · Chats API (§4.8)
//   GET   /chats/:accountId/conversations      · 联系人列表
//   GET   /chats/:accountId/messages           · 消息流 (contactId + limit + beforeId)
//   POST  /chats/:accountId/send-text          · 发文本 · 需持有接管锁
//   POST  /chats/:accountId/send-media         · multipart 发 image/voice/file · 需持有接管锁
//
// 权限 · F 决策: Admin 可用 · operator/viewer 403
// 发送必须先 acquire 锁 (防手动 send 绕过 dispatcher 6 并发 + 健康 gate)

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
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, type RequestUser } from '../auth/decorators/current-user.decorator';
import { UserRole } from '../users/user.entity';
import { BaileysService } from '../baileys/baileys.service';
import { TakeoverLockService } from './takeover-lock.service';
import { TakeoverUploadService } from './takeover-upload.service';
import { TakeoverLockError } from './takeover.errors';
import { SendTextDto, SendMediaMetaDto, ListMessagesQueryDto } from './dto/takeover.dto';
import { TAKEOVER_MESSAGE_OUT, type TakeoverMessageEvent } from './takeover.events';

@Controller('chats')
@UseGuards(RolesGuard)
@Roles(UserRole.Admin)
export class ChatsController {
  constructor(
    private readonly baileys: BaileysService,
    private readonly lock: TakeoverLockService,
    private readonly upload: TakeoverUploadService,
    private readonly eventBus: EventEmitter2,
  ) {}

  @Get(':accountId/conversations')
  async conversations(@Param('accountId', ParseIntPipe) accountId: number) {
    const contacts = await this.baileys.listContacts(accountId);
    return { contacts };
  }

  @Get(':accountId/messages')
  async messages(
    @Param('accountId', ParseIntPipe) accountId: number,
    @Query() q: ListMessagesQueryDto,
  ) {
    const list = await this.baileys.listMessages(accountId, {
      contactId: q.contactId ? Number(q.contactId) : undefined,
      limit: q.limit ? Number(q.limit) : 50,
      beforeId: q.beforeId,
    });
    return { messages: list };
  }

  @Post(':accountId/send-text')
  @HttpCode(200)
  async sendText(
    @Param('accountId', ParseIntPipe) accountId: number,
    @Body() dto: SendTextDto,
    @CurrentUser() user: RequestUser,
  ) {
    this.assertLockHeld(accountId, user);
    const slotId = await this.resolveSlotId(accountId);
    const { waMessageId } = await this.baileys.sendText(slotId, dto.to, dto.text);
    this.lock.heartbeat(accountId, user);
    // 发完 emit out event 让 gateway 回显给所有 tab (本 tab 也收到 · 统一数据流)
    this.emitOut({
      accountId,
      remoteJid: this.normalizeJid(dto.to),
      msgType: 'text',
      content: dto.text,
      mediaPath: null,
      waMessageId,
      sentAt: new Date().toISOString(),
    });
    return { waMessageId };
  }

  @Post(':accountId/send-media')
  @HttpCode(200)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 95 * 1024 * 1024 }, // 95 MB 与 TakeoverUploadService 保持一致
    }),
  )
  async sendMedia(
    @Param('accountId', ParseIntPipe) accountId: number,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; originalname: string; size: number } | undefined,
    @Body() meta: SendMediaMetaDto,
    @CurrentUser() user: RequestUser,
  ) {
    if (!file) throw new BadRequestException('未收到上传文件 (form-data 字段名需为 "file")');
    this.assertLockHeld(accountId, user);
    const slotId = await this.resolveSlotId(accountId);

    const clean = await this.upload.sanitize({
      buffer: file.buffer,
      mimeType: file.mimetype,
      filename: file.originalname,
      type: meta.type,
    });

    const { waMessageId, mediaPath } = await this.baileys.sendMedia(
      slotId,
      meta.to,
      meta.type,
      clean.buffer.toString('base64'),
      { mimeType: clean.mimeType, filename: clean.filename, caption: meta.caption },
    );
    this.lock.heartbeat(accountId, user);
    this.emitOut({
      accountId,
      remoteJid: this.normalizeJid(meta.to),
      msgType: meta.type === 'file' ? 'file' : (meta.type as 'image' | 'voice'),
      content: meta.caption ?? null,
      mediaPath,
      waMessageId,
      sentAt: new Date().toISOString(),
    });
    return { waMessageId, mediaPath, strippedExif: clean.strippedExif, size: clean.size };
  }

  // ── helpers ───────────────────────────────────────────
  private assertLockHeld(accountId: number, user: RequestUser): void {
    const state = this.lock.getLock(accountId);
    if (!state) {
      throw new BadRequestException('NO_ACTIVE_LOCK: 请先 acquire 接管锁再发消息');
    }
    if (state.userId !== user.id && user.role !== UserRole.Admin) {
      throw new ForbiddenException('LOCK_HELD_BY_OTHER: 接管锁由其他用户持有');
    }
  }

  private async resolveSlotId(accountId: number): Promise<number> {
    // baileys.service 的 send 方法已查 slot, 这里只需要从 account→slot · 其实 baileys 内部已处理,
    // 但 baileys.sendText(slotId, ...) 第一参是 slotId, 需先拿到. 借 lock state 里的 slotId.
    const state = this.lock.getLock(accountId);
    if (!state) {
      throw new TakeoverLockError('NO_ACTIVE_LOCK', `account ${accountId} 无活跃锁, 无法定位槽位`);
    }
    return state.slotId;
  }

  private normalizeJid(input: string): string {
    const trimmed = input.trim();
    if (trimmed.includes('@')) return trimmed;
    const digits = trimmed.replace(/[^0-9]/g, '');
    return digits ? `${digits}@s.whatsapp.net` : input;
  }

  private emitOut(params: {
    accountId: number;
    remoteJid: string;
    msgType: TakeoverMessageEvent['msgType'];
    content: string | null;
    mediaPath: string | null;
    waMessageId: string | null;
    sentAt: string;
  }): void {
    const ev: TakeoverMessageEvent = {
      accountId: params.accountId,
      contactId: 0, // gateway 根据 remoteJid 可再查; 暂用 0 占位
      messageId: '0',
      remoteJid: params.remoteJid,
      direction: 'out',
      msgType: params.msgType,
      content: params.content,
      mediaPath: params.mediaPath,
      waMessageId: params.waMessageId,
      sentAt: params.sentAt,
      manual: true,
    };
    this.eventBus.emit(TAKEOVER_MESSAGE_OUT, ev);
  }
}
