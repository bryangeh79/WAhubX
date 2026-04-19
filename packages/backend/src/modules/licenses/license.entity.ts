import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TenantEntity } from '../tenants/tenant.entity';

@Entity('license')
export class LicenseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index({ unique: true })
  @Column({ type: 'text', name: 'license_key' })
  licenseKey!: string;

  @Column({ type: 'int', name: 'tenant_id', nullable: true })
  tenantId!: number | null;

  @ManyToOne(() => TenantEntity, (tenant) => tenant.licenses, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'tenant_id' })
  tenant!: TenantEntity | null;

  @Column({ type: 'text', name: 'machine_fingerprint', nullable: true })
  machineFingerprint!: string | null;

  @Column({ type: 'timestamptz', name: 'issued_at', nullable: true })
  issuedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'expires_at', nullable: true })
  expiresAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'last_verified_at', nullable: true })
  lastVerifiedAt!: Date | null;

  @Column({ type: 'boolean', default: false })
  revoked!: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
