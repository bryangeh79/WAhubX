import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ScriptPackEntity } from './script-pack.entity';

// 技术交接文档 § 3.5. 完整剧本 JSON 存 content JSONB — runtime 解析 turns.
// 不把 turns 拆成单独表, 因为一个剧本就是"原子包", 跨 turn 修改极少,
// 拆表会让"加载 50 剧本 × 20 turns" 膨胀到 1000 行查询.
@Entity('script')
@Unique('uq_script_pack_script_id', ['packId', 'scriptId'])
@Index('idx_script_category', ['category'])
export class ScriptEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', name: 'pack_id' })
  packId!: number;

  @ManyToOne(() => ScriptPackEntity, (p) => p.scripts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pack_id' })
  pack!: ScriptPackEntity;

  // 包内剧本 id, e.g. "s001_morning_simple"
  @Column({ type: 'text', name: 'script_id' })
  scriptId!: string;

  @Column({ type: 'text' })
  name!: string;

  // e.g. daily_greeting / food / work / weekend
  @Column({ type: 'text' })
  category!: string;

  @Column({ type: 'int', name: 'total_turns' })
  totalTurns!: number;

  // 允许执行的最小 warmup_stage (0-3)
  @Column({ type: 'int', name: 'min_warmup_stage', default: 0 })
  minWarmupStage!: number;

  // 是否允许 AI 改写 (M6 真 AI; M4 stub 透传或模板替换)
  @Column({ type: 'boolean', name: 'ai_rewrite', default: true })
  aiRewrite!: boolean;

  // 完整剧本 JSON. 结构: { sessions: [{ turns: [...] }], safety: {...} }
  @Column({ type: 'jsonb' })
  content!: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
