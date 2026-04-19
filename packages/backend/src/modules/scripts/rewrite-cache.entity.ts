import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

// AI 改写缓存 — 同 script/turn/persona 的改写结果复用
// M4 stub: 模板替换 / content_pool 随机 — 没有真 AI 调用, 但走同一张表为 M6 换引擎做准备
@Entity('rewrite_cache')
@Unique('uq_rewrite_script_turn_persona', ['scriptId', 'turnIndex', 'personaHash'])
@Index('idx_rewrite_used', ['usedCount'])
export class RewriteCacheEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'script_id' })
  scriptId!: number;

  @Column({ type: 'int', name: 'turn_index' })
  turnIndex!: number;

  // persona 指纹 (M6 后扩, M4 先用 account_id 的 hash 代替)
  @Column({ type: 'text', name: 'persona_hash' })
  personaHash!: string;

  @Column({ type: 'text', name: 'variant_text' })
  variantText!: string;

  @Column({ type: 'int', name: 'used_count', default: 0 })
  usedCount!: number;

  // 哪个引擎产出 (M4: 'm4_pool_pick'; M6: 'openai' / 'deepseek' / 'gemini' / 'claude')
  @Column({ type: 'text', default: 'm4_pool_pick' })
  source!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
