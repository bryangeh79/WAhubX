import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ScriptEntity } from './script.entity';

// 技术交接文档 § 3.5. .wspack 是一个 JSON (M10 改签名 + 压缩格式)
// M4 只做 JSON 导入 (读 scripts/ 目录 + 后期支持 .wspack 文件上传)
@Entity('script_pack')
@Index('idx_script_pack_pack_id', ['packId'], { unique: true })
export class ScriptPackEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  // 包唯一 id (pack_id from JSON, e.g. "official_my_zh_basic_v1")
  @Column({ type: 'text', name: 'pack_id' })
  packId!: string;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text' })
  version!: string;

  @Column({ type: 'text', default: 'zh' })
  language!: string;

  // e.g. ['MY']
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  country!: string[];

  @Column({ type: 'text', nullable: true })
  author!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  // 需要的资源池列表 (voice / image / sticker / meme pool names) — 给 asset-studio 生成前置检查用
  @Column({ type: 'text', array: true, name: 'asset_pools_required', default: () => "'{}'" })
  assetPoolsRequired!: string[];

  // pack 签名 (M10 加; M4 留空)
  @Column({ type: 'text', nullable: true })
  signature!: string | null;

  // 是否启用 — admin 可禁用不删
  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'installed_at' })
  installedAt!: Date;

  @OneToMany(() => ScriptEntity, (s) => s.pack, { cascade: false })
  scripts!: ScriptEntity[];
}
