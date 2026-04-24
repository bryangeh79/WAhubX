import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum KbStatus {
  Disabled = 0,
  Enabled = 1,
}

@Entity('knowledge_base')
@Index('uq_kb_tenant_name', ['tenantId', 'name'], { unique: true })
export class KnowledgeBaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'tenant_id' })
  tenantId!: number;

  @Column({ type: 'varchar', length: 128 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'text', name: 'goal_prompt', nullable: true })
  goalPrompt!: string | null;

  @Column({ type: 'varchar', length: 8, default: 'zh' })
  language!: string;

  @Column({ type: 'boolean', name: 'is_default', default: false })
  isDefault!: boolean;

  @Column({ type: 'smallint', default: KbStatus.Enabled })
  status!: KbStatus;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
