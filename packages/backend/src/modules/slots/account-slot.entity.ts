import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TenantEntity } from '../tenants/tenant.entity';
import { ProxyEntity } from '../proxies/proxy.entity';
import { WaAccountEntity } from './wa-account.entity';

// 按 WAhubX_技术交接文档 § 3.2:
//   CREATE TABLE account_slot (slot_id INT PRIMARY KEY, ...)
// 技术交接文档的假设是「per-install 单租户」, slot_id 就是 1..50.
// 我们的 dev 现在多租户共一个 DB, 所以拆成:
//   id         SERIAL PK (DB 内部用)
//   slotIndex  INT      (1..slot_limit, 租户视角的槽位号, 每租户内 unique)
// 生产单租户部署时, slotIndex == slot_id 的语义不变.
export enum AccountSlotStatus {
  Empty = 'empty',
  Active = 'active',
  Suspended = 'suspended',
  Warmup = 'warmup',
}

@Entity('account_slot')
@Index('idx_account_slot_tenant', ['tenantId'])
@Index('uq_account_slot_tenant_index', ['tenantId', 'slotIndex'], { unique: true })
export class AccountSlotEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'tenant_id' })
  tenantId!: number;

  @ManyToOne(() => TenantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: TenantEntity;

  // 租户内 1..slot_limit 的槽位号
  @Column({ type: 'int', name: 'slot_index' })
  slotIndex!: number;

  @Column({ type: 'int', name: 'account_id', nullable: true, unique: true })
  accountId!: number | null;

  @OneToOne(() => WaAccountEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'account_id' })
  account!: WaAccountEntity | null;

  @Column({ type: 'enum', enum: AccountSlotStatus, default: AccountSlotStatus.Empty })
  status!: AccountSlotStatus;

  @Column({ type: 'int', name: 'proxy_id', nullable: true })
  proxyId!: number | null;

  @ManyToOne(() => ProxyEntity, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'proxy_id' })
  proxy!: ProxyEntity | null;

  // 人设 JSONB — 创建时为 null, M4 剧本引擎 / AI 生成人设时填
  @Column({ type: 'jsonb', nullable: true })
  persona!: Record<string, unknown> | null;

  // 磁盘路径 per 槽位 (Chromium user-data-dir + Baileys creds).
  // M2 Baileys 集成时填入 data/slots/<slotIndex>/
  @Column({ type: 'text', name: 'profile_path', nullable: true })
  profilePath!: string | null;

  // M3 仲裁 rejection path #4: 手动接管中的槽位不能被 dispatcher 分派任务
  // M9 接管 UI 会通过 /takeover/:accountId/acquire 置 true, /release 置 false
  @Column({ type: 'boolean', name: 'takeover_active', default: false })
  takeoverActive!: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
