import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// 媒体资源索引. 实际文件落在 data/assets/<kind>/<pool>/<filename>
// M4 只记录 schema — 真生成在 M7 (asset-studio: Flux/Piper). 路径 import 也留给 M7.
// M4 runtime 拿不到 asset 时: on_disabled='skip' 跳过; 'send_fallback_text' 发 caption_fallback 文本
export enum AssetKind {
  Voice = 'voice',
  Image = 'image',
  File = 'file',
  Sticker = 'sticker',
}

export enum AssetSource {
  AiGenerated = 'ai_generated',
  Imported = 'imported',
  Pack = 'pack',
  ManualUpload = 'manual_upload', // M7 Day 1 #9 · 用户前端手动上传 · Day 2 asset-studio UI 用
}

@Entity('asset')
@Index('idx_asset_pool', ['poolName'])
@Index('idx_asset_kind_pool', ['kind', 'poolName'])
export class AssetEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  // e.g. "voices_casual_laugh", "images_food_malaysian"
  @Column({ type: 'text', name: 'pool_name' })
  poolName!: string;

  @Column({ type: 'enum', enum: AssetKind })
  kind!: AssetKind;

  // 相对 data/ 的路径, e.g. "assets/voices/casual_laugh/001.ogg"
  @Column({ type: 'text', name: 'file_path' })
  filePath!: string;

  // 语音时长/图片分辨率/人设匹配标记等
  @Column({ type: 'jsonb', nullable: true })
  meta!: Record<string, unknown> | null;

  @Column({ type: 'enum', enum: AssetSource, default: AssetSource.Pack })
  source!: AssetSource;

  // 专属某槽位则填; 通用池为 null
  @Column({ type: 'int', name: 'generated_for_slot', nullable: true })
  generatedForSlot!: number | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
