import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// 2026-04-23 · 广告投放主表 · plan §A.5

// schedule JSONB 4 种 mode · plan §D
export type CampaignSchedule =
  | { mode: 'immediate' }
  | { mode: 'once'; fireAt: string }
  | { mode: 'daily'; time: string; startDate: string; endDate?: string | null }
  | {
      mode: 'weekly';
      days: number[]; // 0=周日 … 6=周六
      time: string;
      startDate: string;
      endDate?: string | null;
    };

export type CampaignScheduleMode = CampaignSchedule['mode'];

// targets JSONB
export interface CampaignTargets {
  groupIds: number[];
  extraPhones: string[];
}

export enum AdStrategy {
  Single = 1,      // 单一广告
  Rotation = 2,    // 多广告轮换
}

export enum OpeningStrategy {
  Fixed = 1,       // 固定开场
  Random = 2,      // 随机开场
  None = 3,        // 不加开场
}

export enum ExecutionMode {
  Smart = 1,       // 系统智能安排 (默认)
  CustomSlots = 2, // 自定义槽位
}

export enum ThrottleProfile {
  Conservative = 1, // 默认 · 保守
  Balanced = 2,     // 平衡
  Aggressive = 3,   // 投放
}

export enum SafetyStatus {
  Green = 1,        // 承载率 ≥ 100%
  Yellow = 2,       // 70-99% 强提醒允许继续
  Red = 3,          // < 70% 禁止启动
}

export enum CampaignStatus {
  Draft = 0,
  Running = 1,
  Paused = 2,
  Done = 3,
  Cancelled = 4,
}

// safety_snapshot JSONB · 启动时冻结的承载计算
export interface SafetySnapshot {
  matureSlots: number;
  eligibleSlots: number;
  dailyCap: number;
  totalTargets: number;
  days: number;
  capacity: number;
  rate: number;
  status: SafetyStatus;
  computedAt: string;
}

@Entity('campaign')
@Index('idx_campaign_tenant_status', ['tenantId', 'status'])
@Index('idx_campaign_tenant_created', ['tenantId', 'createdAt'])
export class CampaignEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'tenant_id' })
  tenantId!: number;

  @Column({ type: 'varchar', length: 128 })
  name!: string;

  @Column({ type: 'jsonb' })
  schedule!: CampaignSchedule;

  @Column({ type: 'jsonb' })
  targets!: CampaignTargets;

  @Column({ type: 'smallint', name: 'ad_strategy', default: AdStrategy.Single })
  adStrategy!: AdStrategy;

  @Column({ type: 'int', array: true, name: 'ad_ids', default: () => "'{}'" })
  adIds!: number[];

  @Column({ type: 'smallint', name: 'opening_strategy', default: OpeningStrategy.Random })
  openingStrategy!: OpeningStrategy;

  @Column({ type: 'int', array: true, name: 'opening_ids', default: () => "'{}'" })
  openingIds!: number[];

  @Column({ type: 'smallint', name: 'execution_mode', default: ExecutionMode.Smart })
  executionMode!: ExecutionMode;

  @Column({ type: 'int', array: true, name: 'custom_slot_ids', default: () => "'{}'" })
  customSlotIds!: number[];

  @Column({ type: 'smallint', name: 'throttle_profile', default: ThrottleProfile.Conservative })
  throttleProfile!: ThrottleProfile;

  @Column({ type: 'smallint', name: 'safety_status', default: SafetyStatus.Green })
  safetyStatus!: SafetyStatus;

  @Column({ type: 'jsonb', name: 'safety_snapshot', nullable: true })
  safetySnapshot!: SafetySnapshot | null;

  @Column({ type: 'smallint', default: CampaignStatus.Draft })
  status!: CampaignStatus;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
