import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type ProtectedEntityType = 'phone' | 'email' | 'url' | 'company' | 'address';

@Entity('knowledge_base_protected')
@Index('idx_kbp_kb', ['kbId'])
export class KbProtectedEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'kb_id' })
  kbId!: number;

  @Column({ type: 'varchar', length: 16, name: 'entity_type' })
  entityType!: ProtectedEntityType;

  @Column({ type: 'varchar', length: 512 })
  value!: string;

  @Column({ type: 'int', name: 'source_id', nullable: true })
  sourceId!: number | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
