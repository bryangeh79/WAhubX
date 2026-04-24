import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export enum ConversationStage {
  New = 'new',
  Interested = 'interested',
  HotLead = 'hot_lead',
  HandoffRequired = 'handoff_required',
  HumanTakeover = 'human_takeover',
  Closed = 'closed',
  DoNotReply = 'do_not_reply',
}

@Entity('customer_conversation')
@Index('uq_cc_tenant_slot_phone', ['tenantId', 'slotId', 'phoneE164'], { unique: true })
@Index('idx_cc_tenant_stage', ['tenantId', 'stage'])
export class CustomerConversationEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'tenant_id' })
  tenantId!: number;

  @Column({ type: 'int', name: 'slot_id' })
  slotId!: number;

  @Column({ type: 'varchar', length: 32, name: 'phone_e164' })
  phoneE164!: string;

  @Column({ type: 'varchar', length: 24, default: ConversationStage.New })
  stage!: ConversationStage;

  @Column({ type: 'int', name: 'kb_id', nullable: true })
  kbId!: number | null;

  @Column({ type: 'bigint', name: 'last_campaign_target_id', nullable: true })
  lastCampaignTargetId!: string | null;

  @Column({ type: 'timestamptz', name: 'last_inbound_at', nullable: true })
  lastInboundAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'last_ai_reply_at', nullable: true })
  lastAiReplyAt!: Date | null;

  @Column({ type: 'int', name: 'ai_reply_count_24h', default: 0 })
  aiReplyCount24h!: number;

  @Column({ type: 'int', name: 'ai_reply_count_total', default: 0 })
  aiReplyCountTotal!: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'opened_at' })
  openedAt!: Date;

  @Column({ type: 'timestamptz', name: 'closed_at', nullable: true })
  closedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  summary!: string | null;
}
