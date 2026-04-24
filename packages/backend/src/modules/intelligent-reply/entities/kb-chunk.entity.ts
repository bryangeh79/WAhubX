import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('knowledge_base_chunk')
@Index('idx_kbc_kb', ['kbId'])
@Index('idx_kbc_source', ['sourceId'])
export class KbChunkEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'kb_id' })
  kbId!: number;

  @Column({ type: 'int', name: 'source_id' })
  sourceId!: number;

  @Column({ type: 'int', name: 'chunk_idx' })
  chunkIdx!: number;

  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'int', name: 'token_count', nullable: true })
  tokenCount!: number | null;

  @Column({ type: 'jsonb', nullable: true })
  embedding!: number[] | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
