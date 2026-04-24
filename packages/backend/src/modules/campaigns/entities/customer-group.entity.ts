import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// 2026-04-23 · 客户群 (联系人清单) · 区别于 execution_group (账号组) · plan §A.3
@Entity('customer_group')
@Index('uq_customer_group_tenant_name', ['tenantId', 'name'], { unique: true })
export class CustomerGroupEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'tenant_id' })
  tenantId!: number;

  @Column({ type: 'varchar', length: 128 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  // 冗余缓存 · 成员变动时由 service 同步更新
  @Column({ type: 'int', name: 'member_count', default: 0 })
  memberCount!: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
