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

// 技术交接文档 § 3.7
@Entity('wa_contact')
@Index('uq_wa_contact_account_jid', ['accountId', 'remoteJid'], { unique: true })
export class WaContactEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'account_id' })
  accountId!: number;

  @ManyToOne(() => WaAccountEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account!: WaAccountEntity;

  // e.g. 60123456789@s.whatsapp.net (个人) / 60123456789-1600000000@g.us (群)
  @Column({ type: 'text', name: 'remote_jid' })
  remoteJid!: string;

  @Column({ type: 'text', name: 'display_name', nullable: true })
  displayName!: string | null;

  // 内部互聊对象 (M4 剧本引擎用: 同租户两账号互发模拟真人)
  @Column({ type: 'boolean', name: 'is_internal', default: false })
  isInternal!: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'added_at' })
  addedAt!: Date;

  @Column({ type: 'timestamptz', name: 'last_message_at', nullable: true })
  lastMessageAt!: Date | null;
}
