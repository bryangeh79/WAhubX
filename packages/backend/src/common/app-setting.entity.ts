import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// 全局 K-V 设置 · 跨模块共享
//   M6: key='ai.text_enabled' (AI 文本改写冷启动开关)
//   M8: key='health.dry_run' / 'health.scoring_window_days'
// 维持单表, 不按模块拆 — 设置种类少, schema 复杂度低. 按 key 前缀分命名空间.
@Entity('app_setting')
export class AppSettingEntity {
  @PrimaryColumn({ type: 'text' })
  key!: string;

  @Column({ type: 'text' })
  value!: string;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
