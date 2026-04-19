import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateChatMessages1776600662633 implements MigrationInterface {
    name = 'CreateChatMessages1776600662633'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "wa_contact" ("id" SERIAL NOT NULL, "account_id" integer NOT NULL, "remote_jid" text NOT NULL, "display_name" text, "is_internal" boolean NOT NULL DEFAULT false, "added_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "last_message_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_c9adbf74ffc2ae0ae1a081c1442" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "uq_wa_contact_account_jid" ON "wa_contact" ("account_id", "remote_jid") `);
        await queryRunner.query(`CREATE TYPE "public"."chat_message_direction_enum" AS ENUM('in', 'out')`);
        await queryRunner.query(`CREATE TYPE "public"."chat_message_msg_type_enum" AS ENUM('text', 'image', 'voice', 'file', 'other')`);
        await queryRunner.query(`CREATE TABLE "chat_message" ("id" BIGSERIAL NOT NULL, "account_id" integer NOT NULL, "contact_id" integer NOT NULL, "direction" "public"."chat_message_direction_enum" NOT NULL, "msg_type" "public"."chat_message_msg_type_enum" NOT NULL DEFAULT 'text', "content" text, "media_path" text, "sent_at" TIMESTAMP WITH TIME ZONE NOT NULL, "wa_message_id" text, "script_run_id" integer, "ai_rewritten" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_3cc0d85193aade457d3077dd06b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_chat_message_account_contact" ON "chat_message" ("account_id", "contact_id") `);
        await queryRunner.query(`CREATE INDEX "idx_chat_message_account_sent" ON "chat_message" ("account_id", "sent_at") `);
        await queryRunner.query(`ALTER TABLE "wa_contact" ADD CONSTRAINT "FK_ba38b0c1ea67539a17f8712f865" FOREIGN KEY ("account_id") REFERENCES "wa_account"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "chat_message" ADD CONSTRAINT "FK_791729d7c521136feb6dd53a29d" FOREIGN KEY ("account_id") REFERENCES "wa_account"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "chat_message" ADD CONSTRAINT "FK_d511143ae11a1cf8fadb540e15a" FOREIGN KEY ("contact_id") REFERENCES "wa_contact"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "chat_message" DROP CONSTRAINT "FK_d511143ae11a1cf8fadb540e15a"`);
        await queryRunner.query(`ALTER TABLE "chat_message" DROP CONSTRAINT "FK_791729d7c521136feb6dd53a29d"`);
        await queryRunner.query(`ALTER TABLE "wa_contact" DROP CONSTRAINT "FK_ba38b0c1ea67539a17f8712f865"`);
        await queryRunner.query(`DROP INDEX "public"."idx_chat_message_account_sent"`);
        await queryRunner.query(`DROP INDEX "public"."idx_chat_message_account_contact"`);
        await queryRunner.query(`DROP TABLE "chat_message"`);
        await queryRunner.query(`DROP TYPE "public"."chat_message_msg_type_enum"`);
        await queryRunner.query(`DROP TYPE "public"."chat_message_direction_enum"`);
        await queryRunner.query(`DROP INDEX "public"."uq_wa_contact_account_jid"`);
        await queryRunner.query(`DROP TABLE "wa_contact"`);
    }

}
