import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// 2026-04-24 · 回复模式
//   off   · 完全人工 (不自动回任何)
//   faq   · 只用 FAQ 匹配 (不调 AI LLM · 不需要租户 API Key)
//   smart · FAQ + AI 兜底 (命中 FAQ 优先, 不命中调 AI · 需要租户 API Key)
export type ReplyMode = 'off' | 'faq' | 'smart';

@Entity('tenant_reply_settings')
export class TenantReplySettingsEntity {
  @PrimaryColumn({ type: 'int', name: 'tenant_id' })
  tenantId!: number;

  @Column({ type: 'varchar', length: 16, default: 'off' })
  mode!: ReplyMode;

  @Column({ type: 'int', name: 'default_kb_id', nullable: true })
  defaultKbId!: number | null;

  @Column({ type: 'int', name: 'daily_ai_reply_limit', default: 200 })
  dailyAiReplyLimit!: number;

  @Column({ type: 'boolean', name: 'quiet_hours_enabled', default: false })
  quietHoursEnabled!: boolean;

  @Column({ type: 'varchar', length: 8, name: 'quiet_hours_start', default: '22:00' })
  quietHoursStart!: string;

  @Column({ type: 'varchar', length: 8, name: 'quiet_hours_end', default: '08:00' })
  quietHoursEnd!: string;

  @Column({ type: 'text', array: true, name: 'blacklist_keywords', default: '{}' })
  blacklistKeywords!: string[];

  @Column({ type: 'text', array: true, name: 'custom_handoff_keywords', default: '{}' })
  customHandoffKeywords!: string[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
