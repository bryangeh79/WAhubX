import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type FaqStatus = 'draft' | 'enabled' | 'disabled';
export type FaqSource = 'ai_generated' | 'manual_bulk' | 'manual_single';

@Entity('knowledge_base_faq')
@Index('idx_kbf_kb_status', ['kbId', 'status'])
export class KbFaqEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'kb_id' })
  kbId!: number;

  @Column({ type: 'text' })
  question!: string;

  @Column({ type: 'text' })
  answer!: string;

  @Column({ type: 'text', array: true, default: '{}' })
  tags!: string[];

  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status!: FaqStatus;

  @Column({ type: 'varchar', length: 16, default: 'manual_single' })
  source!: FaqSource;

  @Column({ type: 'int', name: 'hit_count', default: 0 })
  hitCount!: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
