import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// 2026-04-23 · 广告文案池 · 技术交接文档未原生覆盖, plan rosy-dazzling-wave §A.1
export enum AdvertisementStatus {
  Disabled = 0,
  Enabled = 1,
}

@Entity('advertisement')
@Index('idx_advertisement_tenant_status', ['tenantId', 'status'])
export class AdvertisementEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'tenant_id' })
  tenantId!: number;

  @Column({ type: 'varchar', length: 128 })
  name!: string;

  @Column({ type: 'text' })
  content!: string;

  // 可选媒体 (图/视频), 引用 asset 表
  @Column({ type: 'int', name: 'asset_id', nullable: true })
  assetId!: number | null;

  // 变量占位符, v2 再用
  @Column({ type: 'jsonb', nullable: true })
  variables!: Record<string, unknown> | null;

  @Column({ type: 'smallint', default: AdvertisementStatus.Enabled })
  status!: AdvertisementStatus;

  // 2026-04-24 · AI 变体池 · plan C
  @Column({ type: 'boolean', name: 'ai_enabled', default: false })
  aiEnabled!: boolean;

  // variants: [{ index: number, content: string, enabled: boolean }]
  // index 从 1 起 · 展示为 "1.1 / 1.2 / 1.3" 跟父广告相关联
  @Column({ type: 'jsonb', default: () => "'[]'" })
  variants!: AdvertisementVariant[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}

export interface AdvertisementVariant {
  index: number;
  content: string;
  enabled: boolean;
}
