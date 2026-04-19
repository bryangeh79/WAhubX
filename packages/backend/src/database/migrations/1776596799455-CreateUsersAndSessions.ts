import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateUsersAndSessions1776596799455 implements MigrationInterface {
    name = 'CreateUsersAndSessions1776596799455'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // uuid_generate_v4() 来自 uuid-ossp 扩展 (TypeORM PrimaryGeneratedColumn('uuid') 默认用它)
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TYPE "public"."users_role_enum" AS ENUM('admin', 'operator', 'viewer')`);
        await queryRunner.query(`CREATE TYPE "public"."users_status_enum" AS ENUM('active', 'suspended')`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" integer, "email" character varying(255) NOT NULL, "username" character varying(100) NOT NULL, "password_hash" character varying(255) NOT NULL, "role" "public"."users_role_enum" NOT NULL DEFAULT 'operator', "status" "public"."users_status_enum" NOT NULL DEFAULT 'active', "full_name" character varying(200), "avatar_url" text, "timezone" character varying(50) NOT NULL DEFAULT 'Asia/Kuala_Lumpur', "language" character varying(10) NOT NULL DEFAULT 'zh', "preferences" jsonb NOT NULL DEFAULT '{}', "total_logins" integer NOT NULL DEFAULT '0', "last_login_at" TIMESTAMP WITH TIME ZONE, "failed_login_attempts" integer NOT NULL DEFAULT '0', "locked_until" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "UQ_fe0bb3f6520ee0469504521e710" UNIQUE ("username"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_users_email" ON "users" ("email") `);
        await queryRunner.query(`CREATE INDEX "idx_users_status" ON "users" ("status") `);
        await queryRunner.query(`CREATE INDEX "idx_users_tenant_id" ON "users" ("tenant_id") `);
        await queryRunner.query(`CREATE TABLE "user_sessions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "access_token" text NOT NULL, "refresh_token" text NOT NULL, "device_info" jsonb, "user_agent" text, "ip_address" character varying(45), "revoked" boolean NOT NULL DEFAULT false, "revoked_at" TIMESTAMP WITH TIME ZONE, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e93e031a5fed190d4789b6bfd83" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_user_sessions_access_token" ON "user_sessions" ("access_token") `);
        await queryRunner.query(`CREATE INDEX "idx_user_sessions_refresh_token" ON "user_sessions" ("refresh_token") `);
        await queryRunner.query(`CREATE INDEX "idx_user_sessions_expires_at" ON "user_sessions" ("expires_at") `);
        await queryRunner.query(`CREATE INDEX "idx_user_sessions_user_id" ON "user_sessions" ("user_id") `);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "FK_109638590074998bb72a2f2cf08" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "user_sessions" ADD CONSTRAINT "FK_e9658e959c490b0a634dfc54783" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_sessions" DROP CONSTRAINT "FK_e9658e959c490b0a634dfc54783"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_109638590074998bb72a2f2cf08"`);
        await queryRunner.query(`DROP INDEX "public"."idx_user_sessions_user_id"`);
        await queryRunner.query(`DROP INDEX "public"."idx_user_sessions_expires_at"`);
        await queryRunner.query(`DROP INDEX "public"."idx_user_sessions_refresh_token"`);
        await queryRunner.query(`DROP INDEX "public"."idx_user_sessions_access_token"`);
        await queryRunner.query(`DROP TABLE "user_sessions"`);
        await queryRunner.query(`DROP INDEX "public"."idx_users_tenant_id"`);
        await queryRunner.query(`DROP INDEX "public"."idx_users_status"`);
        await queryRunner.query(`DROP INDEX "public"."idx_users_email"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TYPE "public"."users_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    }

}
