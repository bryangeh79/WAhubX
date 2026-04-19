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

  // 运营商 e.g. Maxis / CelcomDigi / U Mobile / Unifi Mobile
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
