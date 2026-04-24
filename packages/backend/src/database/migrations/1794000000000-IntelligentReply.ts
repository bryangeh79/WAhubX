import { MigrationInterface, QueryRunner } from 'typeorm';

// 2026-04-24 · 智能客服 V1 · 完整 schema
//
// 新表:
//   knowledge_base             · 每租户可有多个 KB
//   knowledge_base_source      · 原始文档
//   knowledge_base_chunk       · 切分后的段落 + embedding (JSONB float[])
//   knowledge_base_faq         · FAQ 条目 · draft/enabled/disabled
//   knowledge_base_protected   · 必须保留的实体 (电话 · 邮箱 · 网站 · 公司名)
//   tenant_reply_settings      · 租户级自动回复设置
//   customer_conversation      · 客户对话状态机
//   pending_inbound_buffer     · 消息聚合缓冲 (8s 窗口)
//   ai_reply_audit             · AI 回复审计日志
//
// campaign 表追加 · 绑定 KB

export class IntelligentReply1794000000000 implements MigrationInterface {
  name = 'IntelligentReply1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // knowledge_base
    await queryRunner.query(`
      CREATE TABLE "knowledge_base" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" integer NOT NULL,
        "name" varchar(128) NOT NULL,
        "description" text,
        "goal_prompt" text,
        "language" varchar(8) NOT NULL DEFAULT 'zh',
        "is_default" boolean NOT NULL DEFAULT false,
        "status" smallint NOT NULL DEFAULT 1,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_kb_tenant" ON "knowledge_base"("tenant_id")`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_kb_tenant_name" ON "knowledge_base"("tenant_id", "name")
    `);

    // knowledge_base_source
    await queryRunner.query(`
      CREATE TABLE "knowledge_base_source" (
        "id" SERIAL PRIMARY KEY,
        "kb_id" integer NOT NULL REFERENCES "knowledge_base"("id") ON DELETE CASCADE,
        "file_name" varchar(255) NOT NULL,
        "mime" varchar(128),
        "kind" varchar(16) NOT NULL,
        "byte_size" integer DEFAULT 0,
        "raw_text" text,
        "processed_at" timestamptz,
        "error_msg" text,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_kbs_kb" ON "knowledge_base_source"("kb_id")`);

    // knowledge_base_chunk · embedding 存 JSONB float[] (V1 不装 pgvector)
    await queryRunner.query(`
      CREATE TABLE "knowledge_base_chunk" (
        "id" SERIAL PRIMARY KEY,
        "kb_id" integer NOT NULL REFERENCES "knowledge_base"("id") ON DELETE CASCADE,
        "source_id" integer NOT NULL REFERENCES "knowledge_base_source"("id") ON DELETE CASCADE,
        "chunk_idx" integer NOT NULL,
        "text" text NOT NULL,
        "token_count" integer,
        "embedding" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_kbc_kb" ON "knowledge_base_chunk"("kb_id")`);
    await queryRunner.query(`CREATE INDEX "idx_kbc_source" ON "knowledge_base_chunk"("source_id")`);

    // knowledge_base_faq
    await queryRunner.query(`
      CREATE TABLE "knowledge_base_faq" (
        "id" SERIAL PRIMARY KEY,
        "kb_id" integer NOT NULL REFERENCES "knowledge_base"("id") ON DELETE CASCADE,
        "question" text NOT NULL,
        "answer" text NOT NULL,
        "tags" text[] DEFAULT '{}',
        "status" varchar(16) NOT NULL DEFAULT 'draft',
        "source" varchar(16) NOT NULL DEFAULT 'manual_single',
        "hit_count" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_kbf_kb_status" ON "knowledge_base_faq"("kb_id","status")`);

    // knowledge_base_protected · 保留实体
    await queryRunner.query(`
      CREATE TABLE "knowledge_base_protected" (
        "id" SERIAL PRIMARY KEY,
        "kb_id" integer NOT NULL REFERENCES "knowledge_base"("id") ON DELETE CASCADE,
        "entity_type" varchar(16) NOT NULL,
        "value" varchar(512) NOT NULL,
        "source_id" integer REFERENCES "knowledge_base_source"("id") ON DELETE SET NULL,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_kbp_kb" ON "knowledge_base_protected"("kb_id")`);

    // tenant_reply_settings · 租户级配置
    await queryRunner.query(`
      CREATE TABLE "tenant_reply_settings" (
        "tenant_id" integer PRIMARY KEY,
        "mode" varchar(16) NOT NULL DEFAULT 'off',
        "default_kb_id" integer REFERENCES "knowledge_base"("id") ON DELETE SET NULL,
        "daily_ai_reply_limit" integer NOT NULL DEFAULT 200,
        "quiet_hours_enabled" boolean NOT NULL DEFAULT false,
        "quiet_hours_start" varchar(8) NOT NULL DEFAULT '22:00',
        "quiet_hours_end" varchar(8) NOT NULL DEFAULT '08:00',
        "blacklist_keywords" text[] DEFAULT '{}',
        "custom_handoff_keywords" text[] DEFAULT '{}',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    // customer_conversation · 客户对话状态机
    await queryRunner.query(`
      CREATE TABLE "customer_conversation" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" integer NOT NULL,
        "slot_id" integer NOT NULL,
        "phone_e164" varchar(32) NOT NULL,
        "stage" varchar(24) NOT NULL DEFAULT 'new',
        "kb_id" integer REFERENCES "knowledge_base"("id") ON DELETE SET NULL,
        "last_campaign_target_id" bigint,
        "last_inbound_at" timestamptz,
        "last_ai_reply_at" timestamptz,
        "ai_reply_count_24h" integer NOT NULL DEFAULT 0,
        "ai_reply_count_total" integer NOT NULL DEFAULT 0,
        "opened_at" timestamptz NOT NULL DEFAULT now(),
        "closed_at" timestamptz,
        "summary" text
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_cc_tenant_slot_phone"
      ON "customer_conversation"("tenant_id","slot_id","phone_e164")
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_cc_tenant_stage"
      ON "customer_conversation"("tenant_id","stage")
    `);

    // pending_inbound_buffer · 聚合窗
    await queryRunner.query(`
      CREATE TABLE "pending_inbound_buffer" (
        "id" SERIAL PRIMARY KEY,
        "conversation_id" integer NOT NULL REFERENCES "customer_conversation"("id") ON DELETE CASCADE,
        "content" text NOT NULL,
        "message_id" varchar(64),
        "received_at" timestamptz NOT NULL DEFAULT now(),
        "flushed" boolean NOT NULL DEFAULT false
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_pib_conv_flushed"
      ON "pending_inbound_buffer"("conversation_id","flushed")
      WHERE "flushed" = false
    `);

    // ai_reply_audit · 审计
    await queryRunner.query(`
      CREATE TABLE "ai_reply_audit" (
        "id" SERIAL PRIMARY KEY,
        "tenant_id" integer NOT NULL,
        "conversation_id" integer REFERENCES "customer_conversation"("id") ON DELETE SET NULL,
        "inbound_message" text,
        "reply_text" text,
        "mode" varchar(16),
        "kb_id" integer,
        "matched_chunk_ids" integer[],
        "matched_faq_id" integer,
        "confidence" numeric(4,3),
        "model" varchar(64),
        "intent" varchar(24),
        "handoff_triggered" boolean DEFAULT false,
        "guardrail_edits" jsonb,
        "sent_message_id" varchar(64),
        "draft" boolean DEFAULT false,
        "cost_tokens_in" integer DEFAULT 0,
        "cost_tokens_out" integer DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_ara_tenant_created"
      ON "ai_reply_audit"("tenant_id","created_at" DESC)
    `);

    // campaign 绑定 KB
    await queryRunner.query(`
      ALTER TABLE "campaign"
      ADD COLUMN IF NOT EXISTS "knowledge_base_id" integer
        REFERENCES "knowledge_base"("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "campaign" DROP COLUMN IF EXISTS "knowledge_base_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_reply_audit"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "pending_inbound_buffer"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_conversation"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tenant_reply_settings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "knowledge_base_protected"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "knowledge_base_faq"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "knowledge_base_chunk"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "knowledge_base_source"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "knowledge_base"`);
  }
}
