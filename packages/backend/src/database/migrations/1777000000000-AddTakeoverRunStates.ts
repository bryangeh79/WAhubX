import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * M9 · 接管 UI
 *
 * 1. task_run_status_enum 增加:
 *    - 'paused'       graceful pause (接管抢占, 可 resume)
 *    - 'interrupted'  hard-kill 强制中断 (30s 兜底, 不扣分, 区分 failed)
 *
 * 2. task_run 加 pause_snapshot jsonb
 *    存抢占时的 executor 状态 (当前 turn / message index / payload) 供 release 后 resume
 *
 * 3. task 加 paused_at TIMESTAMPTZ
 *    标记任务级暂停时刻, dispatcher 读此字段过滤 "pause within takeover"
 *
 * PostgreSQL enum 加值用 ALTER TYPE ADD VALUE (不可逆 · down 重建 enum)
 */
export class AddTakeoverRunStates1777000000000 implements MigrationInterface {
    name = 'AddTakeoverRunStates1777000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // PG: ALTER TYPE ADD VALUE 在事务里执行 OK, 但新值**同事务内使用**受限 (索引 WHERE 子句/插入).
        // 解法: 本次只加 enum 值 + 列, 索引不在此 migration 建. 未来需优化再追加 forward-only migration.
        // (TypeORM default "all" transaction mode 强制事务, 不允许单迁移 transaction=false)
        await queryRunner.query(`ALTER TYPE "public"."task_run_status_enum" ADD VALUE IF NOT EXISTS 'paused'`);
        await queryRunner.query(`ALTER TYPE "public"."task_run_status_enum" ADD VALUE IF NOT EXISTS 'interrupted'`);
        await queryRunner.query(`ALTER TABLE "task_run" ADD COLUMN IF NOT EXISTS "pause_snapshot" jsonb`);
        await queryRunner.query(`ALTER TABLE "task" ADD COLUMN IF NOT EXISTS "paused_at" TIMESTAMP WITH TIME ZONE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // 回滚 enum 加值需重建 type, 涉及强依赖列重写, 代价高.
        // 策略: down 只移列 · enum 残留 paused/interrupted 值视为 forward-only
        // (与 M8 app_setting rename 同样的 forward-only 决策)
        await queryRunner.query(`ALTER TABLE "task" DROP COLUMN IF EXISTS "paused_at"`);
        await queryRunner.query(`ALTER TABLE "task_run" DROP COLUMN IF EXISTS "pause_snapshot"`);
    }
}
