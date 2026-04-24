import { MigrationInterface, QueryRunner } from 'typeorm';

// 2026-04-24 · 回复模式重构
// 旧: off / smart / draft
// 新: off / faq / smart
// 'draft' 模式砍掉 · 之前的 draft 数据安全降到 off

export class ReplyModeFaq1795000000000 implements MigrationInterface {
  name = 'ReplyModeFaq1795000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE tenant_reply_settings SET mode = 'off' WHERE mode = 'draft'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 不可逆 · 原 draft 信息已丢 · down 留空
  }
}
