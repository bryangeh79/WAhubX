import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LicenseEntity } from '../licenses/license.entity';
import { ProxyEntity } from '../proxies/proxy.entity';

export enum TenantPlan {
  Basic = 'basic',
  Pro = 'pro',
  Enterprise = 'enterprise',
}

export enum TenantStatus {
  Active = 'active',
  Suspended = 'suspended',
}

// 套餐 → 槽位数硬映射 (产品: Basic 10 / Pro 30 / Enterprise 50)
export const PLAN_SLOT_LIMIT: Readonly<Record<TenantPlan, number>> = Object.freeze({
  [TenantPlan.Basic]: 10,
  [TenantPlan.Pro]: 30,
  [TenantPlan.Enterprise]: 50,
});

@Entity('tenant')
export class TenantEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  name!: string;

  @Index({ unique: true, where: '"email" IS NOT NULL' })
  @Column({ type: 'text', nullable: true })
  email!: string | null;

  @Column({ type: 'enum', enum: TenantPlan })
  plan!: TenantPlan;

  @Column({ type: 'int', name: 'slot_limit' })
  slotLimit!: number;

  @Column({ type: 'enum', enum: TenantStatus, default: TenantStatus.Active })
  status!: TenantStatus;

  // V1 只做马来西亚, 但架构预埋多国字段
  @Column({ type: 'varchar', length: 2, default: 'MY' })
  country!: string;

  @Column({ type: 'text', default: 'Asia/Kuala_Lumpur' })
  timezone!: string;

  @Column({ type: 'text', default: 'zh' })
  language!: string;

  // 2026-04-25 · 绑号纪律 · 记录上次绑号时间 · 冷却期内拒绝新绑请求
  @Column({ type: 'timestamptz', name: 'last_bind_at', nullable: true })
  lastBindAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => LicenseEntity, (license) => license.tenant)
  licenses!: LicenseEntity[];

  @OneToMany(() => ProxyEntity, (proxy) => proxy.tenant)
  proxies!: ProxyEntity[];
}
