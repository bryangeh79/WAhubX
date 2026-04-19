import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SimInfoEntity } from './sim-info.entity';
import { AccountHealthEntity } from './account-health.entity';

// 养号阶段机: 0=孵化 / 1=预热 / 2=激活 / 3=成熟 (技术交接文档 § 5.3)
export enum WarmupStage {
  Incubation = 0,
  Prewarm = 1,
  Active = 2,
  Mature = 3,
}

@Entity('wa_account')
@Index('idx_wa_account_phone', ['phoneNumber'], { unique: true })
export class WaAccountEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text', name: 'phone_number' })
  phoneNumber!: string;

  @Column({ type: 'varchar', length: 2, name: 'country_code', default: 'MY' })
  countryCode!: string;

  @Column({ type: 'text', default: 'Asia/Kuala_Lumpur' })
  timezone!: string;

  @Column({ type: 'text', name: 'primary_language', default: 'zh' })
  primaryLanguage!: string;

  // ── WA profile (注册成功后 Baileys 上传) ─────────────────
  @Column({ type: 'text', name: 'wa_nickname', nullable: true })
  waNickname!: string | null;

  @Column({ type: 'text', name: 'wa_avatar_path', nullable: true })
  waAvatarPath!: string | null;

  @Column({ type: 'text', name: 'wa_signature', nullable: true })
  waSignature!: string | null;

  @Column({ type: 'timestamptz', name: 'registered_at', nullable: true })
  registeredAt!: Date | null;

  // ── 养号 ────────────────────────────────────────────────
  @Column({ type: 'int', name: 'warmup_stage', default: WarmupStage.Incubation })
  warmupStage!: WarmupStage;

  @Column({ type: 'int', name: 'warmup_day', default: 0 })
  warmupDay!: number;

  // ── 会话 / 设备 ─────────────────────────────────────────
  @Column({ type: 'timestamptz', name: 'last_online_at', nullable: true })
  lastOnlineAt!: Date | null;

  // Baileys creds.json 路径, 典型 data/slots/<slotIndex>/wa-session/
  @Column({ type: 'text', name: 'session_path', nullable: true })
  sessionPath!: string | null;

  // 伪造的设备指纹 (UA/分辨率/时区/型号), 同槽位内跨会话保持稳定
  @Column({ type: 'jsonb', name: 'device_fingerprint', nullable: true })
  deviceFingerprint!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  // ── 1:1 子表 ──────────────────────────────────────────────
  @OneToOne(() => SimInfoEntity, (s) => s.account)
  simInfo?: SimInfoEntity;

  @OneToOne(() => AccountHealthEntity, (h) => h.account)
  health?: AccountHealthEntity;
}
