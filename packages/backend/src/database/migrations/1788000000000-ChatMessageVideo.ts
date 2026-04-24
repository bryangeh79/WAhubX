import { MigrationInterface, QueryRunner } from 'typeorm';

// 2026-04-22 · chat_message.msg_type enum 加 'video'
// entity 早就声明了 Video · 但 DB enum 一直没补 · 导致 send_video 落库报错
export class ChatMessageVideo1788000000000 implements MigrationInterface {
  public async up(qr: QueryRunner): Promise<void> {
    await qr.query(
      `ALTER TYPE "public"."chat_message_msg_type_enum" ADD VALUE IF NOT EXISTS 'video'`,
    );
  }
  public async down(): Promise<void> {
    // PG 不支持删 enum 值
  }
}
