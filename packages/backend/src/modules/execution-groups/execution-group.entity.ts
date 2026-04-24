import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { TenantEntity } from '../tenants/tenant.entity';
import { AccountSlotEntity } from '../slots/account-slot.entity';

@Entity({ name: 'execution_group' })
@Unique('uq_execution_group_tenant_name', ['tenantId', 'name'])
@Index('idx_execution_group_tenant', ['tenantId'])
export class ExecutionGroupEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ name: 'tenant_id' })
  tenantId!: number;

  // 2026-04-21 · 显式 @JoinColumn 避免 TypeORM 自动生成第二个 tenantId 列
  @ManyToOne(() => TenantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: TenantEntity;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description: string | null = null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @ManyToMany(() => AccountSlotEntity, { cascade: false })
  @JoinTable({
    name: 'execution_group_member',
    joinColumn: { name: 'group_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'slot_id', referencedColumnName: 'id' },
  })
  slots?: AccountSlotEntity[];
}
