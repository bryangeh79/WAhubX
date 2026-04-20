import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * M10 · 备份/更新
 *
 * 无 schema 改动 · 只 seed `app_setting` 两键作为 M10 标记 + 语义文档:
 *   - `master_key.migration_done` (default 'false')
 *       标志 MachineBoundMasterKey 迁移是否已完成. MasterKeyMigrationService 启动时
 *       读此键决定是否走 E1 迁移流程 (detect env-encrypted AI keys → pre-migration.wab
 *       → re-encrypt with machine-bound key → set true).
 *
 *   - `backup.last_daily_at` (default 'null')
 *       上次成功每日快照完成时刻 ISO string. BackupService 启动时读此键,
 *       若 > 24h 前 / null → **A+ missed 补跑** 立即触发一次快照 (防用户每晚关机
 *       导致永远没备份). 成功后更新此键.
 *
 * 这两键不存在也不影响服务 (代码侧有 null default 兜底); 种进来是为了 audit trail
 * + migrations 表有 M10 标记.
 *
 * 幂等: ON CONFLICT DO NOTHING · 重跑不覆盖用户已改的值 (比如用户手动 re-migrate 后).
 */
export class SeedBackupSettings1778000000000 implements MigrationInterface {
    name = 'SeedBackupSettings1778000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `INSERT INTO "app_setting" ("key", "value", "updated_at") VALUES
              ('master_key.migration_done', 'false', NOW()),
              ('backup.last_daily_at', 'null', NOW())
            ON CONFLICT ("key") DO NOTHING`
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DELETE FROM "app_setting" WHERE "key" IN ('master_key.migration_done', 'backup.last_daily_at')`
        );
    }
}
