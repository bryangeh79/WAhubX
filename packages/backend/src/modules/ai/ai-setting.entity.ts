import {
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

// 全局 AI 开关 · 单行 K-V. 避免多副作用 (tenant 级预留 V1.1 再拆)
//   key='text_enabled' · value='true'|'false'
//   key='persona_enabled' · V1.1+ 用
// M6 只用 text_enabled. 运行时 /ai-settings/text-enable 更新.
@Entity('ai_setting')
export class AiSettingEntity {
  @PrimaryColumn({ type: 'text' })
  key!: string;

  @Column({ type: 'text' })
  value!: string;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
