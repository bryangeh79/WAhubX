import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// 2026-04-23 · 客户群成员 · plan §A.4
// source 语义:
//   1 · 从 wa_contact 挑选 (系统已认识)
//   2 · CSV / Excel 导入
//   3 · 粘贴号码
export enum CustomerMemberSource {
  ContactPicked = 1,
  CsvImport = 2,
  Paste = 3,
}

// 2026-04-24 · member 健康状态 · 避免重复发给已知坏号
export enum MemberSendStatus {
  Ok = 0,          // 正常, 下次可发
  BadInvalid = 1,  // WA 返号码无效 (443 / invalid jid) · 硬拉黑
  BadNetwork = 2,  // 超时/网络 · 连续失败 3 次 · 软拉黑 (可手动恢复)
  OptedOut = 3,    // 人工标记 "不再发"
}

@Entity('customer_group_member')
@Index('uq_cgm_group_phone', ['groupId', 'phoneE164'], { unique: true })
@Index('idx_cgm_group', ['groupId'])
export class CustomerGroupMemberEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'group_id' })
  groupId!: number;

  @Column({ type: 'int', name: 'contact_id', nullable: true })
  contactId!: number | null;

  // E.164 规范化手机号 (开头不带 +, 全数字, 15 位以内) — service 负责规范化 + 校验
  @Column({ type: 'varchar', length: 32, name: 'phone_e164' })
  phoneE164!: string;

  // 预计算该号码是否是任一 wa_account 的好友 · null 表示未计算
  @Column({ type: 'boolean', name: 'is_friend', nullable: true })
  isFriend!: boolean | null;

  @Column({ type: 'smallint', default: CustomerMemberSource.CsvImport })
  source!: CustomerMemberSource;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  // 2026-04-24 · 健康追踪
  @Column({ type: 'smallint', name: 'send_status', default: MemberSendStatus.Ok })
  sendStatus!: MemberSendStatus;

  @Column({ type: 'int', name: 'send_count', default: 0 })
  sendCount!: number;

  @Column({ type: 'int', name: 'fail_count', default: 0 })
  failCount!: number;

  @Column({ type: 'timestamptz', name: 'last_attempt_at', nullable: true })
  lastAttemptAt!: Date | null;

  @Column({ type: 'varchar', length: 32, name: 'last_error_code', nullable: true })
  lastErrorCode!: string | null;

  @Column({ type: 'text', name: 'last_error_msg', nullable: true })
  lastErrorMsg!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
