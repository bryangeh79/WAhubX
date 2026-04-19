import { MigrationInterface, QueryRunner } from "typeorm";

export class InitCoreTables1776595733527 implements MigrationInterface {
    name = 'InitCoreTables1776595733527'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "license" ("id" SERIAL NOT NULL, "license_key" text NOT NULL, "tenant_id" integer, "machine_fingerprint" text, "issued_at" TIMESTAMP WITH TIME ZONE, "expires_at" TIMESTAMP WITH TIME ZONE, "last_verified_at" TIMESTAMP WITH TIME ZONE, "revoked" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f168ac1ca5ba87286d03b2ef905" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_1452e56036f836c55bd48ba298" ON "license" ("license_key") `);
        await queryRunner.query(`CREATE TYPE "public"."proxy_proxy_type_enum" AS ENUM('residential_static', 'residential_rotating', 'datacenter')`);
        await queryRunner.query(`CREATE TYPE "public"."proxy_status_enum" AS ENUM('ok', 'down', 'unknown')`);
        await queryRunner.query(`CREATE TABLE "proxy" ("id" SERIAL NOT NULL, "tenant_id" integer NOT NULL, "proxy_type" "public"."proxy_proxy_type_enum" NOT NULL, "host" text NOT NULL, "port" integer NOT NULL, "username" text, "password" text, "country" text, "city" text, "status" "public"."proxy_status_enum" NOT NULL DEFAULT 'unknown', "last_check_at" TIMESTAMP WITH TIME ZONE, "avg_latency_ms" integer, "bound_slot_ids" integer array NOT NULL DEFAULT '{}', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_581edf779fc90b8d2687c658276" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."tenant_plan_enum" AS ENUM('basic', 'pro', 'enterprise')`);
        await queryRunner.query(`CREATE TYPE "public"."tenant_status_enum" AS ENUM('active', 'suspended')`);
        await queryRunner.query(`CREATE TABLE "tenant" ("id" SERIAL NOT NULL, "name" text NOT NULL, "email" text, "plan" "public"."tenant_plan_enum" NOT NULL, "slot_limit" integer NOT NULL, "status" "public"."tenant_status_enum" NOT NULL DEFAULT 'active', "country" character varying(2) NOT NULL DEFAULT 'MY', "timezone" text NOT NULL DEFAULT 'Asia/Kuala_Lumpur', "language" text NOT NULL DEFAULT 'zh', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_da8c6efd67bb301e810e56ac139" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_158579c5a50360c530ff54838e" ON "tenant" ("email") WHERE "email" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "license" ADD CONSTRAINT "FK_76e556afe6925cabc4c8f73b61e" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "proxy" ADD CONSTRAINT "FK_a9e5a925ab8fa0c59485f4613c7" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "proxy" DROP CONSTRAINT "FK_a9e5a925ab8fa0c59485f4613c7"`);
        await queryRunner.query(`ALTER TABLE "license" DROP CONSTRAINT "FK_76e556afe6925cabc4c8f73b61e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_158579c5a50360c530ff54838e"`);
        await queryRunner.query(`DROP TABLE "tenant"`);
        await queryRunner.query(`DROP TYPE "public"."tenant_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."tenant_plan_enum"`);
        await queryRunner.query(`DROP TABLE "proxy"`);
        await queryRunner.query(`DROP TYPE "public"."proxy_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."proxy_proxy_type_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1452e56036f836c55bd48ba298"`);
        await queryRunner.query(`DROP TABLE "license"`);
    }

}
