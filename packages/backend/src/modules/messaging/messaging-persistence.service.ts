// 2026-04-28 · Phase D · 从 BaileysService.persistMessage 抽出
// 持久化 + emit takeover.message.in · runtime 中性 · chromium / 任意 runtime 都能用

import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChatMessageEntity, MessageDirection, MessageType } from './chat-message.entity';
import { WaContactEntity } from './wa-contact.entity';
import { AccountSlotEntity } from '../slots/account-slot.entity';

export interface PersistMessageParams {
  accountId: number;
  remoteJid: string;
  direction: MessageDirection;
  msgType: MessageType;
  content: string | null;
  mediaPath?: string | null;
  sentAt: Date;
  waMessageId: string | null;
  pushName?: string | null;
  updateContactLastMessageAt?: boolean;
}

@Injectable()
export class MessagingPersistenceService {
  private readonly logger = new Logger(MessagingPersistenceService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly eventBus: EventEmitter2,
  ) {}

  async persistMessage(
    params: PersistMessageParams,
  ): Promise<{ contactId: number; messageId: string }> {
    let contactId = 0;
    let messageId = '0';
    await this.dataSource.transaction(async (manager) => {
      let contact = await manager.findOne(WaContactEntity, {
        where: { accountId: params.accountId, remoteJid: params.remoteJid },
      });
      if (!contact) {
        contact = manager.create(WaContactEntity, {
          accountId: params.accountId,
          remoteJid: params.remoteJid,
          displayName: params.pushName ?? null,
          lastMessageAt: (params.updateContactLastMessageAt ?? true) ? params.sentAt : null,
        });
        contact = await manager.save(contact);
      } else {
        const patch: { displayName?: string | null; lastMessageAt?: Date } = {};
        if (!contact.displayName && params.pushName) patch.displayName = params.pushName;
        if (params.updateContactLastMessageAt ?? true) patch.lastMessageAt = params.sentAt;
        if (Object.keys(patch).length > 0) {
          await manager.update(WaContactEntity, contact.id, patch);
        }
      }
      contactId = contact.id;

      const msg = manager.create(ChatMessageEntity, {
        accountId: params.accountId,
        contactId: contact.id,
        direction: params.direction,
        msgType: params.msgType,
        content: params.content,
        mediaPath: params.mediaPath ?? null,
        sentAt: params.sentAt,
        waMessageId: params.waMessageId,
      });
      const saved = await manager.save(msg);
      messageId = String(saved.id);
    });

    if (params.direction === MessageDirection.In) {
      try {
        let slotRole: 'broadcast' | 'customer_service' | undefined;
        try {
          const slot = await this.dataSource
            .getRepository(AccountSlotEntity)
            .findOne({ where: { accountId: params.accountId } });
          slotRole = (slot?.role as 'broadcast' | 'customer_service' | undefined) ?? undefined;
        } catch {
          /* role 查不到不阻塞 emit */
        }
        this.eventBus.emit('takeover.message.in', {
          accountId: params.accountId,
          contactId,
          messageId,
          remoteJid: params.remoteJid,
          direction: params.direction,
          msgType: params.msgType,
          content: params.content,
          mediaPath: params.mediaPath ?? null,
          waMessageId: params.waMessageId,
          sentAt: params.sentAt.toISOString(),
          manual: false,
          slotRole,
        });
      } catch (err) {
        this.logger.debug(
          `emit takeover.message.in failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    return { contactId, messageId };
  }
}
