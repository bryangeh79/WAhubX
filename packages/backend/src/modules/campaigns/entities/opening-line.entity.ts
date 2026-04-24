import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// 2026-04-23 · 开场白池 · 广告投放前缀文本 · plan §A.2
export enum OpeningLineStatus {
  Disabled = 0,
  Enabled = 1,
}

@Entity('opening_line')
@Index('idx_opening_line_tenant_status', ['tenantId', 'status'])
export class OpeningLineEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'tenant_id' })
  tenantId!: number;

  @Column({ type: 'varchar', length: 64 })
  name!: string;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'smallint', default: OpeningLineStatus.Enabled })
  status!: OpeningLineStatus;

  // 2026-04-24 · AI 变体池 · 跟广告同设计
  @Column({ type: 'boolean', name: 'ai_enabled', default: false })
  aiEnabled!: boolean;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  variants!: OpeningLineVariant[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}

export interface OpeningLineVariant {
  index: number;
  content: string;
  enabled: boolean;
}
