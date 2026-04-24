import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TenantEntity } from '../tenants/tenant.entity';

export enum ProxyType {
  // 协议 (2026-04-22 扩 · 和 buildProxyAgent / 前端 bind modal 对齐)
  Http = 'http',
  Https = 'https',
  Socks4 = 'socks4',
  Socks5 = 'socks5',
  // IP 源分类 (原值 · 保留向后兼容)
  ResidentialStatic = 'residential_static',
  ResidentialRotating = 'residential_rotating',
  Datacenter = 'datacenter',
}

export enum ProxyStatus {
  Ok = 'ok',
  Down = 'down',
  Unknown = 'unknown',
}

@Entity('proxy')
export class ProxyEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'tenant_id' })
  tenantId!: number;

  @ManyToOne(() => TenantEntity, (tenant) => tenant.proxies, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: TenantEntity;

  @Column({ type: 'enum', enum: ProxyType, name: 'proxy_type' })
  proxyType!: ProxyType;

  @Column({ type: 'text' })
  host!: string;

  @Column({ type: 'int' })
  port!: number;

  @Column({ type: 'text', nullable: true })
  username!: string | null;

  // TODO(M10/安全审计): 密码落地需加密存储 (AES-GCM)，当前仅脚手架明文
  @Column({ type: 'text', nullable: true })
  password!: string | null;

  @Column({ type: 'text', nullable: true })
  country!: string | null;

  @Column({ type: 'text', nullable: true })
  city!: string | null;

  @Column({ type: 'enum', enum: ProxyStatus, default: ProxyStatus.Unknown })
  status!: ProxyStatus;

  @Column({ type: 'timestamptz', name: 'last_check_at', nullable: true })
  lastCheckAt!: Date | null;

  @Column({ type: 'int', name: 'avg_latency_ms', nullable: true })
  avgLatencyMs!: number | null;

  // 共享此 IP 的槽位 id 数组 (1..50, 按技术交接文档 § 3.3)
  @Column({ type: 'int', array: true, name: 'bound_slot_ids', default: () => "'{}'" })
  boundSlotIds!: number[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
