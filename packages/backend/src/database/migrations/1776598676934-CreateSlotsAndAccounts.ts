import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSlotsAndAccounts1776598676934 implements MigrationInterface {
    name = 'CreateSlotsAndAccounts1776598676934'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."account_health_risk_level_enum" AS ENUM('low', 'medium', 'high')`);
        await queryRunner.query(`CREATE TABLE "account_health" ("account_id" integer NOT NULL, "health_score" integer NOT NULL DEFAULT '100', "risk_level" "public"."account_health_risk_level_enum" NOT NULL DEFAULT 'low', "risk_flags" jsonb NOT NULL DEFAULT '[]', "total_sent" integer NOT NULL DEFAULT '0', "total_received" integer NOT NULL DEFAULT '0', "send_fail_rate" numeric(5,4), "last_incident" jsonb, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_b9342856ff00d46bd98c14c4757" PRIMARY KEY ("account_id"))`);
        await queryRunner.query(`CREATE TABLE "wa_account" ("id" SERIAL NOT NULL, "phone_number" text NOT NULL, "country_code" character varying(2) NOT NULL DEFAULT 'MY', "timezone" text NOT NULL DEFAULT 'Asia/Kuala_Lumpur', "primary_language" text NOT NULL DEFAULT 'zh', "wa_nickname" text, "wa_avatar_path" text, "wa_signature" text, "registered_at" TIMESTAMP WITH TIME ZONE, "warmup_stage" integer NOT NULL DEFAULT '0', "warmup_day" integer NOT NULL DEFAULT '0', "last_online_at" TIMESTAMP WITH TIME ZONE, "session_path" text, "device_fingerprint" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_249cc658d8042b61f78a37b2305" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "idx_wa_account_phone" ON "wa_account" ("phone_number") `);
        await queryRunner.query(`CREATE TYPE "public"."sim_info_sim_type_enum" AS ENUM('prepaid', 'postpaid', 'esim')`);
        await queryRunner.query(`CREATE TABLE "sim_info" ("account_id" integer NOT NULL, "carrier" text, "sim_type" "public"."sim_info_sim_type_enum", "registered_name" text, "activated_date" date, "monthly_cost" numeric(10,2), "notes" text, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2e9654f57f2047fcd7d5def6f57" PRIMARY KEY ("account_id"))`);
        await queryRunner.query(`CREATE TYPE "public"."account_slot_status_enum" AS ENUM('empty', 'active', 'suspended', 'warmup')`);
        await queryRunner.query(`CREATE TABLE "account_slot" ("id" SERIAL NOT NULL, "tenant_id" integer NOT NULL, "slot_index" integer NOT NULL, "account_id" integer, "status" "public"."account_slot_status_enum" NOT NULL DEFAULT 'empty', "proxy_id" integer, "persona" jsonb, "profile_path" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_e79394772b44868e8fc5b5d43c6" UNIQUE ("account_id"), CONSTRAINT "REL_e79394772b44868e8fc5b5d43c" UNIQUE ("account_id"), CONSTRAINT "PK_da99e10aea89fe60ab1033fcecc" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_account_slot_tenant_index" ON "account_slot" ("tenant_id", "slot_index") `);
        await queryRunner.query(`CREATE INDEX "idx_account_slot_tenant" ON "account_slot" ("tenant_id") `);
        await queryRunner.query(`ALTER TABLE "account_health" ADD CONSTRAINT "FK_b9342856ff00d46bd98c14c4757" FOREIGN KEY ("account_id") REFERENCES "wa_account"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sim_info" ADD CONSTRAINT "FK_2e9654f57f2047fcd7d5def6f57" FOREIGN KEY ("account_id") REFERENCES "wa_account"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "account_slot" ADD CONSTRAINT "FK_ccde9c438ddb12aa27ffe1eeb8f" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "account_slot" ADD CONSTRAINT "FK_e79394772b44868e8fc5b5d43c6" FOREIGN KEY ("account_id") REFERENCES "wa_account"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "account_slot" ADD CONSTRAINT "FK_96f0ed8cf246f51a246fc080017" FOREIGN KEY ("proxy_id") REFERENCES "proxy"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "account_slot" DROP CONSTRAINT "FK_96f0ed8cf246f51a246fc080017"`);
        await queryRunner.query(`ALTER TABLE "account_slot" DROP CONSTRAINT "FK_e79394772b44868e8fc5b5d43c6"`);
        await queryRunner.query(`ALTER TABLE "account_slot" DROP CONSTRAINT "FK_ccde9c438ddb12aa27ffe1eeb8f"`);
        await queryRunner.query(`ALTER TABLE "sim_info" DROP CONSTRAINT "FK_2e9654f57f2047fcd7d5def6f57"`);
        await queryRunner.query(`ALTER TABLE "account_health" DROP CONSTRAINT "FK_b9342856ff00d46bd98c14c4757"`);
        await queryRunner.query(`DROP INDEX "public"."idx_account_slot_tenant"`);
        await queryRunner.query(`DROP INDEX "public"."uq_account_slot_tenant_index"`);
        await queryRunner.query(`DROP TABLE "account_slot"`);
        await queryRunner.query(`DROP TYPE "public"."account_slot_status_enum"`);
        await queryRunner.query(`DROP TABLE "sim_info"`);
        await queryRunner.query(`DROP TYPE "public"."sim_info_sim_type_enum"`);
        await queryRunner.query(`DROP INDEX "public"."idx_wa_account_phone"`);
        await queryRunner.query(`DROP TABLE "wa_account"`);
        await queryRunner.query(`DROP TABLE "account_health"`);
        await queryRunner.query(`DROP TYPE "public"."account_health_risk_level_enum"`);
    }

}
