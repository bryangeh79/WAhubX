import { MigrationInterface, QueryRunner } from 'typeorm';

// 2026-04-22 · asset.kind enum 加 'video'
export class AssetKindVideo1787000000000 implements MigrationInterface {
  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TYPE "public"."asset_kind_enum" ADD VALUE IF NOT EXISTS 'video'`);
  }
  public async down(): Promise<void> {
    // PG enum 不支持删值
  }
}
