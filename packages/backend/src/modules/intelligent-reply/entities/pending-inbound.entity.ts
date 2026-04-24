import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('pending_inbound_buffer')
@Index('idx_pib_conv_flushed', ['conversationId', 'flushed'])
export class PendingInboundEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'conversation_id' })
  conversationId!: number;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'varchar', length: 64, name: 'message_id', nullable: true })
  messageId!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'received_at' })
  receivedAt!: Date;

  @Column({ type: 'boolean', default: false })
  flushed!: boolean;
}
