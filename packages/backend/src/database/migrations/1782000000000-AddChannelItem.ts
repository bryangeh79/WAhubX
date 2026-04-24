import { MigrationInterface, QueryRunner } from 'typeorm';

// 2026-04-21 · 频道素材库 · 支持 follow_channel 的 3 模式 (随机/按tag/手动)
// 预置 global=true 种子数据由 WAhubX 官方发布, tenant_id=NULL
// 租户自己录的 global=false, tenant_id 隔离
export class AddChannelItem1782000000000 implements MigrationInterface {
  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE "channel_item" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" INT REFERENCES "tenant"("id") ON DELETE CASCADE,
        "global" BOOLEAN NOT NULL DEFAULT false,
        "name" TEXT NOT NULL,
        "invite_code" TEXT,
        "jid" TEXT,
        "description" TEXT,
        "tags" TEXT[] NOT NULL DEFAULT '{}',
        "subscribers" INT,
        "last_verified_at" TIMESTAMPTZ,
        "enabled" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await qr.query(`CREATE INDEX idx_channel_item_tenant ON channel_item(tenant_id);`);
    await qr.query(`CREATE INDEX idx_channel_item_global ON channel_item(global);`);
    await qr.query(`CREATE INDEX idx_channel_item_tags ON channel_item USING GIN (tags);`);
    await qr.query(`
      CREATE UNIQUE INDEX uq_channel_item_tenant_invite
        ON channel_item(COALESCE(tenant_id, 0), invite_code) WHERE invite_code IS NOT NULL;
    `);
  }

  public async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS "channel_item";`);
  }
}
