import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateTasksAndTakeover1776612590751 implements MigrationInterface {
    name = 'CreateTasksAndTakeover1776612590751'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."task_target_type_enum" AS ENUM('account', 'group')`);
        await queryRunner.query(`CREATE TYPE "public"."task_status_enum" AS ENUM('pending', 'queued', 'running', 'done', 'failed', 'cancelled', 'skipped')`);
        await queryRunner.query(`CREATE TABLE "task" ("id" SERIAL NOT NULL, "tenant_id" integer NOT NULL, "task_type" character varying(64) NOT NULL, "priority" integer NOT NULL DEFAULT '5', "scheduled_at" TIMESTAMP WITH TIME ZONE, "repeat_rule" text, "target_type" "public"."task_target_type_enum" NOT NULL, "target_ids" integer array NOT NULL DEFAULT '{}', "payload" jsonb, "status" "public"."task_status_enum" NOT NULL DEFAULT 'pending', "last_error" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_fb213f79ee45060ba925ecd576e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_task_tenant_status" ON "task" ("tenant_id", "status") `);
        await queryRunner.query(`CREATE INDEX "idx_task_status_scheduled" ON "task" ("status", "scheduled_at") `);
        await queryRunner.query(`CREATE TYPE "public"."task_run_status_enum" AS ENUM('running', 'success', 'failed', 'skipped')`);
        await queryRunner.query(`CREATE TABLE "task_run" ("id" SERIAL NOT NULL, "task_id" integer NOT NULL, "account_id" integer, "started_at" TIMESTAMP WITH TIME ZONE NOT NULL, "finished_at" TIMESTAMP WITH TIME ZONE, "status" "public"."task_run_status_enum" NOT NULL, "error_code" text, "error_message" text, "logs" jsonb NOT NULL DEFAULT '[]', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_36326cc52f4708f36ae4e6158cc" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_task_run_account_started" ON "task_run" ("account_id", "started_at") `);
        await queryRunner.query(`CREATE INDEX "idx_task_run_task" ON "task_run" ("task_id") `);
        await queryRunner.query(`ALTER TABLE "account_slot" ADD "takeover_active" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "task_run" ADD CONSTRAINT "FK_90ef5150f1d1c77822f3d0cd8f8" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "task_run" DROP CONSTRAINT "FK_90ef5150f1d1c77822f3d0cd8f8"`);
        await queryRunner.query(`ALTER TABLE "account_slot" DROP COLUMN "takeover_active"`);
        await queryRunner.query(`DROP INDEX "public"."idx_task_run_task"`);
        await queryRunner.query(`DROP INDEX "public"."idx_task_run_account_started"`);
        await queryRunner.query(`DROP TABLE "task_run"`);
        await queryRunner.query(`DROP TYPE "public"."task_run_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."idx_task_status_scheduled"`);
        await queryRunner.query(`DROP INDEX "public"."idx_task_tenant_status"`);
        await queryRunner.query(`DROP TABLE "task"`);
        await queryRunner.query(`DROP TYPE "public"."task_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."task_target_type_enum"`);
    }

}
