import { MigrationInterface, QueryRunner } from 'typeorm';

// 2026-04-23 · 广告投放向导 v1 · 新增 7 张表
// 设计稿: plan rosy-dazzling-wave.md
//
// 严格规则 (不破坏现有稳定架构):
//   - 只 CREATE TABLE + CREATE INDEX, 0 ALTER 任何现有表
//   - FK 指向 tenant / wa_contact / asset / account_slot 等现有表, 不反向加 FK
//   - 整模块 feature flag 由 app_setting 'campaign.module_enabled' 控制 (default false)
//
// 表清单:
//   1. advertisement          · 广告文案池
//   2. opening_line           · 开场白池
//   3. customer_group         · 客户群 (联系人清单)
//   4. customer_group_member  · 客户群成员 (引用 wa_contact 或纯号码)
//   5. campaign               · 投放任务主表
//   6. campaign_run           · 每次触发实例 (daily/weekly 一次 1 行)
//   7. campaign_target        · 该 run 的目标对象 + 分配的 slot + 状态
export class Campaigns1789000000000 implements MigrationInterface {
  name = 'Campaigns1789000000000';

  public async up(qr: QueryRunner): Promise<void> {
    // ─── 1. advertisement ─────────────────────────────────────────────
    await qr.query(`
      CREATE TABLE IF NOT EXISTS "advertisement" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" INT NOT NULL REFERENCES "tenant"("id") ON DELETE CASCADE,
        "name" VARCHAR(128) NOT NULL,
        "content" TEXT NOT NULL,
        "asset_id" INT REFERENCES "asset"("id") ON DELETE SET NULL,
        "variables" JSONB,
        "status" SMALLINT NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS "idx_advertisement_tenant_status" ON "advertisement" ("tenant_id", "status")`);

    // ─── 2. opening_line ──────────────────────────────────────────────
    await qr.query(`
      CREATE TABLE IF NOT EXISTS "opening_line" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" INT NOT NULL REFERENCES "tenant"("id") ON DELETE CASCADE,
        "name" VARCHAR(64) NOT NULL,
        "content" TEXT NOT NULL,
        "status" SMALLINT NOT NULL DEFAULT 1,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS "idx_opening_line_tenant_status" ON "opening_line" ("tenant_id", "status")`);

    // ─── 3. customer_group ────────────────────────────────────────────
    await qr.query(`
      CREATE TABLE IF NOT EXISTS "customer_group" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" INT NOT NULL REFERENCES "tenant"("id") ON DELETE CASCADE,
        "name" VARCHAR(128) NOT NULL,
        "description" TEXT,
        "member_count" INT NOT NULL DEFAULT 0,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await qr.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_customer_group_tenant_name" ON "customer_group" ("tenant_id", "name")`,
    );

    // ─── 4. customer_group_member ─────────────────────────────────────
    // source: 1=wa_contact 挑选 · 2=CSV 导入 · 3=粘贴
    await qr.query(`
      CREATE TABLE IF NOT EXISTS "customer_group_member" (
        "id" SERIAL PRIMARY KEY,
        "group_id" INT NOT NULL REFERENCES "customer_group"("id") ON DELETE CASCADE,
        "contact_id" INT REFERENCES "wa_contact"("id") ON DELETE SET NULL,
        "phone_e164" VARCHAR(32) NOT NULL,
        "is_friend" BOOLEAN,
        "source" SMALLINT NOT NULL DEFAULT 2,
        "note" TEXT,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await qr.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_cgm_group_phone" ON "customer_group_member" ("group_id", "phone_e164")`,
    );
    await qr.query(`CREATE INDEX IF NOT EXISTS "idx_cgm_group" ON "customer_group_member" ("group_id")`);

    // ─── 5. campaign ──────────────────────────────────────────────────
    // schedule JSONB 模式: {mode: immediate|once|daily|weekly, ...}
    // targets JSONB: {groupIds: number[], extraPhones: string[]}
    // ad_strategy: 1=单一 · 2=多广告轮换
    // opening_strategy: 1=固定 · 2=随机 · 3=不加
    // execution_mode: 1=系统智能 · 2=自定义槽位
    // throttle_profile: 1=保守(默认) · 2=平衡 · 3=投放
    // safety_status: 1=绿 · 2=黄 · 3=红
    // status: 0=draft · 1=running · 2=paused · 3=done · 4=cancelled
    await qr.query(`
      CREATE TABLE IF NOT EXISTS "campaign" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" INT NOT NULL REFERENCES "tenant"("id") ON DELETE CASCADE,
        "name" VARCHAR(128) NOT NULL,
        "schedule" JSONB NOT NULL,
        "targets" JSONB NOT NULL,
        "ad_strategy" SMALLINT NOT NULL DEFAULT 1,
        "ad_ids" INT[] NOT NULL DEFAULT '{}',
        "opening_strategy" SMALLINT NOT NULL DEFAULT 2,
        "opening_ids" INT[] NOT NULL DEFAULT '{}',
        "execution_mode" SMALLINT NOT NULL DEFAULT 1,
        "custom_slot_ids" INT[] NOT NULL DEFAULT '{}',
        "throttle_profile" SMALLINT NOT NULL DEFAULT 1,
        "safety_status" SMALLINT NOT NULL DEFAULT 1,
        "safety_snapshot" JSONB,
        "status" SMALLINT NOT NULL DEFAULT 0,
        "created_by" UUID REFERENCES "users"("id") ON DELETE SET NULL,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS "idx_campaign_tenant_status" ON "campaign" ("tenant_id", "status")`);
    await qr.query(`CREATE INDEX IF NOT EXISTS "idx_campaign_tenant_created" ON "campaign" ("tenant_id", "created_at" DESC)`);

    // ─── 6. campaign_run ──────────────────────────────────────────────
    // status: 0=pending · 1=running · 2=done · 3=cancelled
    // stats JSONB: {planned, sent, failed, skipped}
    await qr.query(`
      CREATE TABLE IF NOT EXISTS "campaign_run" (
        "id" SERIAL PRIMARY KEY,
        "campaign_id" INT NOT NULL REFERENCES "campaign"("id") ON DELETE CASCADE,
        "fire_at" TIMESTAMPTZ NOT NULL,
        "started_at" TIMESTAMPTZ,
        "finished_at" TIMESTAMPTZ,
        "status" SMALLINT NOT NULL DEFAULT 0,
        "stats" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS "idx_campaign_run_campaign_fire" ON "campaign_run" ("campaign_id", "fire_at")`);
    await qr.query(
      `CREATE INDEX IF NOT EXISTS "idx_campaign_run_status_fire_pending" ON "campaign_run" ("status", "fire_at") WHERE "status" IN (0, 1)`,
    );

    // ─── 7. campaign_target ───────────────────────────────────────────
    // status: 0=pending · 1=dispatched · 2=sent · 3=failed · 4=skipped
    await qr.query(`
      CREATE TABLE IF NOT EXISTS "campaign_target" (
        "id" BIGSERIAL PRIMARY KEY,
        "run_id" INT NOT NULL REFERENCES "campaign_run"("id") ON DELETE CASCADE,
        "campaign_id" INT NOT NULL REFERENCES "campaign"("id") ON DELETE CASCADE,
        "phone_e164" VARCHAR(32) NOT NULL,
        "contact_id" INT REFERENCES "wa_contact"("id") ON DELETE SET NULL,
        "assigned_slot_id" INT REFERENCES "account_slot"("id") ON DELETE SET NULL,
        "ad_id" INT REFERENCES "advertisement"("id") ON DELETE SET NULL,
        "opening_id" INT REFERENCES "opening_line"("id") ON DELETE SET NULL,
        "task_id" INT REFERENCES "task"("id") ON DELETE SET NULL,
        "status" SMALLINT NOT NULL DEFAULT 0,
        "error_code" VARCHAR(32),
        "error_msg" TEXT,
        "sent_at" TIMESTAMPTZ,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS "idx_campaign_target_run_status" ON "campaign_target" ("run_id", "status")`);
    await qr.query(
      `CREATE INDEX IF NOT EXISTS "idx_campaign_target_slot_pending" ON "campaign_target" ("assigned_slot_id", "status") WHERE "status" IN (0, 1)`,
    );
    await qr.query(
      `CREATE INDEX IF NOT EXISTS "idx_campaign_target_campaign_sent" ON "campaign_target" ("campaign_id", "sent_at")`,
    );
    await qr.query(
      `CREATE INDEX IF NOT EXISTS "idx_campaign_target_slot_sentdate" ON "campaign_target" ("assigned_slot_id", "sent_at") WHERE "status" = 2`,
    );

    // ─── 8. Seed feature flag + throttle defaults (app_setting) ──────
    // 默认 feature flag = false → 所有广告路由 403 + scheduler 不 tick + tab 不显
    const seeds: Array<[string, string]> = [
      ['campaign.module_enabled', 'false'],
      ['campaign.throttle.conservative.daily_cap', '20'],
      ['campaign.throttle.conservative.windows', JSON.stringify([['10:00', '12:00'], ['14:00', '17:00'], ['19:00', '22:00']])],
      ['campaign.throttle.conservative.gap_sec', JSON.stringify([40, 120])],
      ['campaign.throttle.balanced.daily_cap', '30'],
      ['campaign.throttle.balanced.windows', JSON.stringify([['10:00', '12:00'], ['14:00', '17:00'], ['19:00', '22:00']])],
      ['campaign.throttle.balanced.gap_sec', JSON.stringify([30, 90])],
      ['campaign.throttle.aggressive.daily_cap', '40'],
      ['campaign.throttle.aggressive.windows', JSON.stringify([['10:00', '12:00'], ['19:00', '22:00']])],
      ['campaign.throttle.aggressive.gap_sec', JSON.stringify([20, 60])],
      ['campaign.default_horizon_days', '7'],
    ];
    for (const [key, value] of seeds) {
      await qr.query(
        `INSERT INTO "app_setting" ("key", "value") VALUES ($1, $2) ON CONFLICT ("key") DO NOTHING`,
        [key, value],
      );
    }
  }

  public async down(qr: QueryRunner): Promise<void> {
    const seedKeys = [
      'campaign.module_enabled',
      'campaign.throttle.conservative.daily_cap',
      'campaign.throttle.conservative.windows',
      'campaign.throttle.conservative.gap_sec',
      'campaign.throttle.balanced.daily_cap',
      'campaign.throttle.balanced.windows',
      'campaign.throttle.balanced.gap_sec',
      'campaign.throttle.aggressive.daily_cap',
      'campaign.throttle.aggressive.windows',
      'campaign.throttle.aggressive.gap_sec',
      'campaign.default_horizon_days',
    ];
    for (const k of seedKeys) {
      await qr.query(`DELETE FROM "app_setting" WHERE "key" = $1`, [k]);
    }

    await qr.query(`DROP TABLE IF EXISTS "campaign_target"`);
    await qr.query(`DROP TABLE IF EXISTS "campaign_run"`);
    await qr.query(`DROP TABLE IF EXISTS "campaign"`);
    await qr.query(`DROP TABLE IF EXISTS "customer_group_member"`);
    await qr.query(`DROP TABLE IF EXISTS "customer_group"`);
    await qr.query(`DROP TABLE IF EXISTS "opening_line"`);
    await qr.query(`DROP TABLE IF EXISTS "advertisement"`);
  }
}
