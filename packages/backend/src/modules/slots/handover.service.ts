// 2026-04-22 · 账号转出手机 · 导出 chats/contacts/channels
// 基本原则: WA 号转到手机只需 SIM + OTP · 不需要扫老设备 QR
// 系统侧责任: 提前导出历史数据 (WA 官方 backup 不兼容 Baileys)
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountSlotEntity } from './account-slot.entity';
import { WaContactEntity } from '../baileys/wa-contact.entity';
import { ChatMessageEntity } from '../baileys/chat-message.entity';

@Injectable()
export class HandoverService {
  private readonly logger = new Logger(HandoverService.name);

  constructor(
    @InjectRepository(AccountSlotEntity)
    private readonly slotRepo: Repository<AccountSlotEntity>,
    @InjectRepository(WaContactEntity)
    private readonly contactRepo: Repository<WaContactEntity>,
    @InjectRepository(ChatMessageEntity)
    private readonly msgRepo: Repository<ChatMessageEntity>,
  ) {}

  async exportContactsCsv(slotId: number, tenantId: number | null): Promise<string> {
    const slot = await this.loadSlot(slotId, tenantId);
    if (!slot.accountId) throw new NotFoundException('槽位无账号');
    const contacts = await this.contactRepo.find({
      where: { accountId: slot.accountId },
      order: { lastMessageAt: 'DESC' },
    });
    const header = 'name,jid,kind,last_seen\n';
    const kindOf = (jid: string) =>
      jid.endsWith('@g.us') ? 'group' : jid.endsWith('@newsletter') ? 'channel' : 'contact';
    const rows = contacts.map((c) => {
      const name = (c.displayName ?? '').replace(/[",\n]/g, ' ');
      const last = c.lastMessageAt ? c.lastMessageAt.toISOString() : '';
      return `"${name}","${c.remoteJid}","${kindOf(c.remoteJid)}","${last}"`;
    });
    return header + rows.join('\n');
  }

  async exportChannelsAndGroupsTxt(
    slotId: number,
    tenantId: number | null,
  ): Promise<string> {
    const slot = await this.loadSlot(slotId, tenantId);
    if (!slot.accountId) throw new NotFoundException('槽位无账号');
    const contacts = await this.contactRepo.find({
      where: { accountId: slot.accountId },
    });
    const channels = contacts.filter((c) => c.remoteJid.endsWith('@newsletter'));
    const groups = contacts.filter((c) => c.remoteJid.endsWith('@g.us'));
    const ph = slot.account?.phoneNumber ?? '(unknown)';
    const lines: string[] = [];
    lines.push(`# 账号 ${ph} · 导出于 ${new Date().toISOString()}`);
    lines.push('');
    lines.push(`=== 已 Follow 频道 (${channels.length}) ===`);
    for (const c of channels) {
      lines.push(`${c.displayName ?? '(无名)'} · ${c.remoteJid}`);
    }
    lines.push('');
    lines.push(`=== 已加群 (${groups.length}) ===`);
    for (const g of groups) {
      lines.push(`${g.displayName ?? '(无名)'} · ${g.remoteJid}`);
    }
    return lines.join('\n');
  }

  async exportChatsTxt(slotId: number, tenantId: number | null): Promise<string> {
    const slot = await this.loadSlot(slotId, tenantId);
    if (!slot.accountId) throw new NotFoundException('槽位无账号');
    const messages = await this.msgRepo.find({
      where: { accountId: slot.accountId },
      order: { sentAt: 'ASC' },
      take: 10000, // V1 简版 · 最多 1w 条
    });
    const contacts = new Map(
      (await this.contactRepo.find({ where: { accountId: slot.accountId } })).map(
        (c) => [c.id, c],
      ),
    );
    const lines: string[] = [];
    for (const m of messages) {
      const c = contacts.get(m.contactId);
      const name = c?.displayName ?? c?.remoteJid ?? '?';
      const ts = m.sentAt ? m.sentAt.toISOString() : '';
      const dir = m.direction === 'in' ? '←' : '→';
      const content = m.content ? m.content.slice(0, 500) : `[${m.msgType}]`;
      lines.push(`[${ts}] ${dir} ${name}: ${content}`);
    }
    return lines.join('\n');
  }

  async markReplaced(slotId: number, tenantId: number | null): Promise<AccountSlotEntity> {
    const slot = await this.loadSlot(slotId, tenantId);
    // 直接等同于 factory clear · 让 slot 回 empty 准备新号
    // 现有 clear 实装在 SlotsService · 这里只标记 · 租户再手动清
    this.logger.log(
      `slot ${slot.id} handover marked · 租户请用 '原厂重置' 清 session 释放槽位`,
    );
    return slot;
  }

  private async loadSlot(slotId: number, tenantId: number | null): Promise<AccountSlotEntity> {
    const slot = await this.slotRepo.findOne({
      where: { id: slotId },
      relations: ['account'],
    });
    if (!slot) throw new NotFoundException(`槽位 ${slotId} 不存在`);
    if (tenantId !== null && slot.tenantId !== tenantId) {
      throw new ForbiddenException('无权限');
    }
    return slot;
  }
}
