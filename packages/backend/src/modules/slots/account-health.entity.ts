import {
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { WaAccountEntity } from './wa-account.entity';

// 技术交接文档 § 5.4:
//   low    60-100  正常
//   medium 30-59   自动降速 50%
//   high   0-29    暂停主动任务 + 桌面告警
export enum RiskLevel {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

@Entity('account_health')
export class AccountHealthEntity {
  @PrimaryColumn({ type: 'int', name: 'account_id' })
  accountId!: number;

  @OneToOne(() => WaAccountEntity, (a) => a.health, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'account_id' })
  account!: WaAccountEntity;

  // 起始 100, 按规则扣减/加成 (M8 健康分引擎实装)
  @Column({ type: 'int', name: 'health_score', default: 100 })
  healthScore!: number;

  @Column({ type: 'enum', enum: RiskLevel, name: 'risk_level', default: RiskLevel.Low })
  riskLevel!: RiskLevel;

  // 风险事件列表: [{ code, severity, at }]
  @Column({ type: 'jsonb', name: 'risk_flags', default: () => "'[]'" })
  riskFlags!: Array<{ code: string; severity: string; at: string }>;

  @Column({ type: 'int', name: 'total_sent', default: 0 })
  totalSent!: number;

  @Column({ type: 'int', name: 'total_received', default: 0 })
  totalReceived!: number;

  @Column({ type: 'decimal', precision: 5, scale: 4, name: 'send_fail_rate', nullable: true })
  sendFailRate!: string | null;

  @Column({ type: 'jsonb', name: 'last_incident', nullable: true })
  lastIncident!: Record<string, unknown> | null;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
