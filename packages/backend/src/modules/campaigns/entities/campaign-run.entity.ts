import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// 2026-04-23 · 每次触发实例 · plan §A.6
export enum CampaignRunStatus {
  Pending = 0,
  Running = 1,
  Done = 2,
  Cancelled = 3,
}

export interface CampaignRunStats {
  planned?: number;
  sent?: number;
  failed?: number;
  skipped?: number;
}

@Entity('campaign_run')
@Index('idx_campaign_run_campaign_fire', ['campaignId', 'fireAt'])
export class CampaignRunEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'campaign_id' })
  campaignId!: number;

  // 规划触发时间 (schedule 展开结果)
  @Column({ type: 'timestamptz', name: 'fire_at' })
  fireAt!: Date;

  @Column({ type: 'timestamptz', name: 'started_at', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt!: Date | null;

  @Column({ type: 'smallint', default: CampaignRunStatus.Pending })
  status!: CampaignRunStatus;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  stats!: CampaignRunStats;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
