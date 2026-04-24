import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type KbSourceKind = 'pdf' | 'docx' | 'txt' | 'manual' | 'url';

@Entity('knowledge_base_source')
@Index('idx_kbs_kb', ['kbId'])
export class KbSourceEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'kb_id' })
  kbId!: number;

  @Column({ type: 'varchar', length: 255, name: 'file_name' })
  fileName!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  mime!: string | null;

  @Column({ type: 'varchar', length: 16 })
  kind!: KbSourceKind;

  @Column({ type: 'int', name: 'byte_size', default: 0 })
  byteSize!: number;

  @Column({ type: 'text', name: 'raw_text', nullable: true })
  rawText!: string | null;

  @Column({ type: 'timestamptz', name: 'processed_at', nullable: true })
  processedAt!: Date | null;

  @Column({ type: 'text', name: 'error_msg', nullable: true })
  errorMsg!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
