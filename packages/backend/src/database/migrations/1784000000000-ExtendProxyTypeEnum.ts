import { MigrationInterface, QueryRunner } from 'typeorm';

// 2026-04-22 · 扩代理类型枚举 · 支持实际协议值 (http/https/socks4/socks5)
// 原值 (residential_static/residential_rotating/datacenter) 保留作为 IP 源分类 · 但新增的是实际协议
// · buildProxyAgent 已支持全部 6 值
// · bind 流程的 "添加新代理" modal 本来就在用 http/socks5 · 之前写入会被校验拒
export class ExtendProxyTypeEnum1784000000000 implements MigrationInterface {
  public async up(qr: QueryRunner): Promise<void> {
    // PostgreSQL 不支持一次 ADD 多值 · 必须单条
    await qr.query(`ALTER TYPE "public"."proxy_proxy_type_enum" ADD VALUE IF NOT EXISTS 'http'`);
    await qr.query(`ALTER TYPE "public"."proxy_proxy_type_enum" ADD VALUE IF NOT EXISTS 'https'`);
    await qr.query(`ALTER TYPE "public"."proxy_proxy_type_enum" ADD VALUE IF NOT EXISTS 'socks4'`);
    await qr.query(`ALTER TYPE "public"."proxy_proxy_type_enum" ADD VALUE IF NOT EXISTS 'socks5'`);
  }

  public async down(): Promise<void> {
    // PostgreSQL 不支持从 enum 删值 · 回滚空操作
  }
}
