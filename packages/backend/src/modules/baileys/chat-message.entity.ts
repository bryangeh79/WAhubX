import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { WaAccountEntity } from '../slots/wa-account.entity';
import { WaContactEntity } from './wa-contact.entity';

export enum MessageDirection {
  In = 'in',
  Out = 'out',
}

// M2 只做 text; image/voice/file 在 M2 W3 + M9 扩展
export enum MessageType {
  Text = 'text',
  Image = 'image',
  Voice = 'voice',
  File = 'file',
  Other = 'other',
}

// 技术交接文档 § 3.7. BIGSERIAL 应对长期运营单号几十万条消息量级.
@Entity('chat_message')
@Index('idx_chat_message_account_sent', ['accountId', 'sentAt'])
@Index('idx_chat_message_account_contact', ['accountId', 'contactId'])
export class ChatMessageEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string;

  @Column({ type: 'int', name: 'account_id' })
  accountId!: number;

  @ManyToOne(() => WaAccountEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account!: WaAccountEntity;

  @Column({ type: 'int', name: 'contact_id' })
  contactId!: number;

  @ManyToOne(() => WaContactEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contact_id' })
  contact!: WaContactEntity;

  @Column({ type: 'enum', enum: MessageDirection })
  direction!: MessageDirection;

  @Column({ type: 'enum', enum: MessageType, name: 'msg_type', default: MessageType.Text })
  msgType!: MessageType;

  @Column({ type: 'text', nullable: true })
  content!: string | null;

  // 本地文件相对路径 (M2 W3+), e.g. data/slots/01/media/<msg-id>.jpg
  @Column({ type: 'text', name: 'media_path', nullable: true })
  mediaPath!: string | null;

  @Column({ type: 'timestamptz', name: 'sent_at' })
  sentAt!: Date;

  // WA 原始消息 ID, 用于追踪 / 去重 / 撤回
  @Column({ type: 'text', name: 'wa_message_id', nullable: true })
  waMessageId!: string | null;

  // 关联到 task_run (M3) — 判定这条消息是剧本发的还是手动发的
  @Column({ type: 'int', name: 'script_run_id', nullable: true })
  scriptRunId!: number | null;

  // 是否经 AI 改写 (M6)
  @Column({ type: 'boolean', name: 'ai_rewritten', default: false })
  aiRewritten!: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
