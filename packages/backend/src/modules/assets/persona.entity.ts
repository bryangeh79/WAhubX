// M7 Day 1 #7 · Persona 独立表 · 绑 asset + slot 复用
//
// 与 account_slot.persona (JSONB) 共存:
//   - account_slot.persona · M3/M4 遗留 · 单 slot 单 persona 简单绑定
//   - persona 表 · M7+ · 独立实体 · 1:N asset + M:N slot (via used_by_slot_ids)
// M7 Day 4 PersonaGeneratorService 只写此表 · slot.persona 做增量 snapshot
//
// content 字段存 PersonaV1 完整结构 · 应用层用 PersonaV1Schema 校验
// content_hash 用 computePersonaHash 算 · 16 hex

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { PersonaV1 } from './persona.types';

@Entity('persona')
@Index('idx_persona_ethnicity', ['ethnicity'])
@Index('idx_persona_hash', ['contentHash'])
export class PersonaEntity {
  /** PersonaV1.persona_id · TEXT 主键 · 跨机稳定 */
  @PrimaryColumn({ type: 'text', name: 'persona_id' })
  personaId!: string;

  @Column({ type: 'text', name: 'display_name' })
  displayName!: string;

  @Column({ type: 'text', name: 'wa_nickname' })
  waNickname!: string;

  /** EthnicityMY · V1 仅 chinese-malaysian */
  @Column({ type: 'text' })
  ethnicity!: string;

  @Column({ type: 'varchar', length: 2, default: 'MY' })
  country!: string;

  /** PersonaV1 完整 JSON · 应用层 Zod 校验 */
  @Column({ type: 'jsonb' })
  content!: PersonaV1;

  /** computePersonaHash(persona) · 16 hex · cache 键 + debounce 用 */
  @Column({ type: 'varchar', length: 16, name: 'content_hash' })
  contentHash!: string;

  /** 绑定的 avatar asset · Day 4 生成后填 */
  @Column({ type: 'int', name: 'avatar_asset_id', nullable: true })
  avatarAssetId!: number | null;

  /** 哪些 slot 用此 persona · N:M 简化为 array (小基数 · < 50) */
  @Column({ type: 'int', array: true, name: 'used_by_slot_ids', default: () => "'{}'" })
  usedBySlotIds!: number[];

  /** 'ai_generated' / 'manual_upload' / 'imported' · 与 asset.source 同域 */
  @Column({ type: 'text', default: 'ai_generated' })
  source!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
