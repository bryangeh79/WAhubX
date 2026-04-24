import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type AuditMode = 'faq' | 'ai' | 'handoff' | 'skipped';

@Entity('ai_reply_audit')
@Index('idx_ara_tenant_created', ['tenantId', 'createdAt'])
export class AiReplyAuditEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'tenant_id' })
  tenantId!: number;

  @Column({ type: 'int', name: 'conversation_id', nullable: true })
  conversationId!: number | null;

  @Column({ type: 'text', name: 'inbound_message', nullable: true })
  inboundMessage!: string | null;

  @Column({ type: 'text', name: 'reply_text', nullable: true })
  replyText!: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  mode!: AuditMode | null;

  @Column({ type: 'int', name: 'kb_id', nullable: true })
  kbId!: number | null;

  @Column({ type: 'int', array: true, name: 'matched_chunk_ids', nullable: true })
  matchedChunkIds!: number[] | null;

  @Column({ type: 'int', name: 'matched_faq_id', nullable: true })
  matchedFaqId!: number | null;

  @Column({ type: 'numeric', precision: 4, scale: 3, nullable: true })
  confidence!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  model!: string | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  intent!: string | null;

  @Column({ type: 'boolean', name: 'handoff_triggered', default: false })
  handoffTriggered!: boolean;

  @Column({ type: 'jsonb', name: 'guardrail_edits', nullable: true })
  guardrailEdits!: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 64, name: 'sent_message_id', nullable: true })
  sentMessageId!: string | null;

  @Column({ type: 'boolean', default: false })
  draft!: boolean;

  @Column({ type: 'int', name: 'cost_tokens_in', default: 0 })
  costTokensIn!: number;

  @Column({ type: 'int', name: 'cost_tokens_out', default: 0 })
  costTokensOut!: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
