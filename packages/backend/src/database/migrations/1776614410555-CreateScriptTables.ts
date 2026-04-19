import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateScriptTables1776614410555 implements MigrationInterface {
    name = 'CreateScriptTables1776614410555'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "script_pack" ("id" SERIAL NOT NULL, "pack_id" text NOT NULL, "name" text NOT NULL, "version" text NOT NULL, "language" text NOT NULL DEFAULT 'zh', "country" text array NOT NULL DEFAULT '{}', "author" text, "description" text, "asset_pools_required" text array NOT NULL DEFAULT '{}', "signature" text, "enabled" boolean NOT NULL DEFAULT true, "installed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_23d2dbcdb1710799a14ffccf99f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "idx_script_pack_pack_id" ON "script_pack" ("pack_id") `);
        await queryRunner.query(`CREATE TABLE "script" ("id" SERIAL NOT NULL, "pack_id" integer NOT NULL, "script_id" text NOT NULL, "name" text NOT NULL, "category" text NOT NULL, "total_turns" integer NOT NULL, "min_warmup_stage" integer NOT NULL DEFAULT '0', "ai_rewrite" boolean NOT NULL DEFAULT true, "content" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_script_pack_script_id" UNIQUE ("pack_id", "script_id"), CONSTRAINT "PK_90683f80965555e177a0e7346af" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_script_category" ON "script" ("category") `);
        await queryRunner.query(`CREATE TABLE "rewrite_cache" ("id" SERIAL NOT NULL, "script_id" integer NOT NULL, "turn_index" integer NOT NULL, "persona_hash" text NOT NULL, "variant_text" text NOT NULL, "used_count" integer NOT NULL DEFAULT '0', "source" text NOT NULL DEFAULT 'm4_pool_pick', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "uq_rewrite_script_turn_persona" UNIQUE ("script_id", "turn_index", "persona_hash"), CONSTRAINT "PK_36885d1ae48d57bbc7f37405e02" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_rewrite_used" ON "rewrite_cache" ("used_count") `);
        await queryRunner.query(`CREATE TYPE "public"."asset_kind_enum" AS ENUM('voice', 'image', 'file', 'sticker')`);
        await queryRunner.query(`CREATE TYPE "public"."asset_source_enum" AS ENUM('ai_generated', 'imported', 'pack')`);
        await queryRunner.query(`CREATE TABLE "asset" ("id" SERIAL NOT NULL, "pool_name" text NOT NULL, "kind" "public"."asset_kind_enum" NOT NULL, "file_path" text NOT NULL, "meta" jsonb, "source" "public"."asset_source_enum" NOT NULL DEFAULT 'pack', "generated_for_slot" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1209d107fe21482beaea51b745e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_asset_kind_pool" ON "asset" ("kind", "pool_name") `);
        await queryRunner.query(`CREATE INDEX "idx_asset_pool" ON "asset" ("pool_name") `);
        await queryRunner.query(`ALTER TABLE "script" ADD CONSTRAINT "FK_23d2dbcdb1710799a14ffccf99f" FOREIGN KEY ("pack_id") REFERENCES "script_pack"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "script" DROP CONSTRAINT "FK_23d2dbcdb1710799a14ffccf99f"`);
        await queryRunner.query(`DROP INDEX "public"."idx_asset_pool"`);
        await queryRunner.query(`DROP INDEX "public"."idx_asset_kind_pool"`);
        await queryRunner.query(`DROP TABLE "asset"`);
        await queryRunner.query(`DROP TYPE "public"."asset_source_enum"`);
        await queryRunner.query(`DROP TYPE "public"."asset_kind_enum"`);
        await queryRunner.query(`DROP INDEX "public"."idx_rewrite_used"`);
        await queryRunner.query(`DROP TABLE "rewrite_cache"`);
        await queryRunner.query(`DROP INDEX "public"."idx_script_category"`);
        await queryRunner.query(`DROP TABLE "script"`);
        await queryRunner.query(`DROP INDEX "public"."idx_script_pack_pack_id"`);
        await queryRunner.query(`DROP TABLE "script_pack"`);
    }

}
