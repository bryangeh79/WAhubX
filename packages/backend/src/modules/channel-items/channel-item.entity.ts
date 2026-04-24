import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'channel_item' })
@Index('idx_channel_item_tenant', ['tenantId'])
@Index('idx_channel_item_global', ['global'])
export class ChannelItemEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'tenant_id', type: 'int', nullable: true })
  tenantId: number | null = null;

  /** 全局种子 · WAhubX 官方发的 · 所有租户可见 */
  @Column({ type: 'boolean', default: false })
  global!: boolean;

  @Column({ type: 'text' })
  name!: string;

  @Column({ name: 'invite_code', type: 'text', nullable: true })
  inviteCode: string | null = null;

  @Column({ type: 'text', nullable: true })
  jid: string | null = null;

  @Column({ type: 'text', nullable: true })
  description: string | null = null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  tags!: string[];

  @Column({ type: 'int', nullable: true })
  subscribers: number | null = null;

  @Column({ name: 'last_verified_at', type: 'timestamptz', nullable: true })
  lastVerifiedAt: Date | null = null;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
