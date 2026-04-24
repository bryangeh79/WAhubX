import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// 2026-04-23 · 本次 run 的具体投放目标 + 分配结果 · plan §A.7
export enum CampaignTargetStatus {
  Pending = 0,      // 尚未分配
  Dispatched = 1,   // 已生成 task, 等 dispatcher 捡起
  Sent = 2,         // 已成功发送
  Failed = 3,       // 发送失败
  Skipped = 4,      // 跳过 (承载超限 / 对方不是有效号等)
}

@Entity('campaign_target')
@Index('idx_campaign_target_run_status', ['runId', 'status'])
@Index('idx_campaign_target_campaign_sent', ['campaignId', 'sentAt'])
export class CampaignTargetEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id!: string; // BIGSERIAL · TypeORM 建议用 string 防精度丢失

  @Column({ type: 'int', name: 'run_id' })
  runId!: number;

  @Column({ type: 'int', name: 'campaign_id' })
  campaignId!: number;

  @Column({ type: 'varchar', length: 32, name: 'phone_e164' })
  phoneE164!: string;

  @Column({ type: 'int', name: 'contact_id', nullable: true })
  contactId!: number | null;

  @Column({ type: 'int', name: 'assigned_slot_id', nullable: true })
  assignedSlotId!: number | null;

  @Column({ type: 'int', name: 'ad_id', nullable: true })
  adId!: number | null;

  @Column({ type: 'int', name: 'opening_id', nullable: true })
  openingId!: number | null;

  // 关联生成的 task 行 · executor 通过 task.payload.campaignTargetId 反查
  @Column({ type: 'int', name: 'task_id', nullable: true })
  taskId!: number | null;

  @Column({ type: 'smallint', default: CampaignTargetStatus.Pending })
  status!: CampaignTargetStatus;

  @Column({ type: 'varchar', length: 32, name: 'error_code', nullable: true })
  errorCode!: string | null;

  @Column({ type: 'text', name: 'error_msg', nullable: true })
  errorMsg!: string | null;

  @Column({ type: 'timestamptz', name: 'sent_at', nullable: true })
  sentAt!: Date | null;

  // 2026-04-24 · 回复归因 · 首次回复时间 (后续回复不覆盖)
  @Column({ type: 'timestamptz', name: 'replied_at', nullable: true })
  repliedAt!: Date | null;

  @Column({ type: 'int', name: 'reply_count', default: 0 })
  replyCount!: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
