import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { WaAccountEntity } from './wa-account.entity';

export enum SimType {
  Prepaid = 'prepaid',
  Postpaid = 'postpaid',
  ESim = 'esim',
}

@Entity('sim_info')
export class SimInfoEntity {
  @PrimaryColumn({ type: 'int', name: 'account_id' })
  accountId!: number;

  @OneToOne(() => WaAccountEntity, (a) => a.simInfo, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account!: WaAccountEntity;

  // 2026-04-22 · 新 · 国家 ISO alpha-2 (MY / ID / US / ...) · 从号码自动推 · 也可手填
  @Column({ type: 'varchar', length: 2, name: 'country_code', nullable: true })
  countryCode!: string | null;

  // 2026-04-22 · 新 · telco-registry key · 命中预置库时用
  @Column({ type: 'varchar', length: 40, name: 'carrier_id', nullable: true })
  carrierId!: string | null;

  // 2026-04-22 · 新 · 租户手填 telco 名 (Tier 2/3 兜底)
  @Column({ type: 'varchar', length: 80, name: 'custom_carrier_name', nullable: true })
  customCarrierName!: string | null;

  // 2026-04-22 · 新 · 租户手填国家名 (Tier 3 冷门国家)
  @Column({ type: 'varchar', length: 80, name: 'custom_country_name', nullable: true })
  customCountryName!: string | null;

  // 2026-04-22 · 新 · ICCID 尾号 (选填 · 只存后 6-10 位方便人眼辨识卡)
  @Column({ type: 'varchar', length: 10, name: 'iccid_suffix', nullable: true })
  iccidSuffix!: string | null;

  // 旧字段 · 保留向后兼容 (早期手填的运营商名字 · 新版走 carrierId / customCarrierName)
  @Column({ type: 'text', nullable: true })
  carrier!: string | null;

  @Column({ type: 'enum', enum: SimType, name: 'sim_type', nullable: true })
  simType!: SimType | null;

  @Column({ type: 'text', name: 'registered_name', nullable: true })
  registeredName!: string | null;

  @Column({ type: 'date', name: 'activated_date', nullable: true })
  activatedDate!: Date | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'monthly_cost', nullable: true })
  monthlyCost!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
