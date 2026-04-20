// M11 Day 2 · `.wupd` manifest 类型定义 · signing 模块内部类型
//
// 参考 M10 v0.10.0-m10 CHANGELOG 的 `.wupd manifest 字段设计文档` → 这里正式定
// 字段命名约定 (snake_case) 与 M10 WabManifest 保持一致 (兼容性/调试性).

/** migration 条目 · TypeORM timestamp + 文件名 + 校验 */
export interface WupdMigrationEntry {
  /** TypeORM migration 文件名 (含 timestamp 前缀), e.g. '1778000000000-SeedBackupSettings' */
  name: string;
  /** migration 文件 SHA-256 hex · 防传输中被替换 */
  sha256: string;
}

/** 升级失败 health 检查条件 · installer 用此决定是否回滚 */
export interface WupdHealthCheck {
  /** HTTP 路径 · default '/api/v1/health' */
  endpoint: string;
  /** 等 backend 健康的最大秒数 · 超过视为失败 · default 60 */
  timeout_sec: number;
  /** 期望 HTTP 状态码 · default 200 */
  expect_status: number;
}

/** 升级失败回滚策略 · V1 仅 restore_pre_update_snapshot */
export interface WupdRollbackConfig {
  /** 'restore_pre_update_snapshot' — 用 pre-update.wab + app/ 备份还原 */
  strategy: 'restore_pre_update_snapshot';
}

/**
 * `.wupd` 升级包 manifest · JSON 序列化后嵌入 zip 根
 *
 * 签名流程:
 *   1. 构造 manifest (不含 signature 字段)
 *   2. 用 Ed25519 私钥签 canonical JSON 字节
 *   3. signature = 'ed25519:' + base64url(64B)
 *   4. 把 signature 写回 manifest → 完整版嵌 .wupd
 *
 * 校验流程 (backend + installer 双校):
 *   1. 解析 manifest · 提取 signature · 拆 prefix + b64
 *   2. **移除** signature 字段 · canonical JSON serialize
 *   3. 用 public key 校验签名 · false → 拒绝整个 .wupd
 *   4. 验 app_sha256 + migrations[].sha256 · 有差异 → 拒
 */
export interface WupdManifest {
  /** 升级前版本 · from_version !== current → 拒 */
  from_version: string;
  /** 升级后版本 · SemVer strict (Z1 决策) · MAJOR 升级 UI 额外确认 */
  to_version: string;
  /** app/ 目录打包后 (tar) 的 sha256 hex · installer 解包前校验 */
  app_sha256: string;
  /** 新版本新增 migrations · backend onModuleInit 跑 · 顺序 = 数组顺序 */
  migrations: WupdMigrationEntry[];
  /** 升级完成后 installer 如何判定"成功" */
  health_check: WupdHealthCheck;
  /** 失败时如何回滚 */
  rollback: WupdRollbackConfig;
  /** ISO 时间 · .wupd 打包时刻 · 防重放旧包 (installer 可选校验 within N days) */
  created_at: string;
  /** Ed25519 签名 · 格式 'ed25519:' + base64url(64B) · 签的是本 manifest 去掉 signature 字段后的 canonical JSON */
  signature?: string;
}

/** `.wupd` 外层 header · magic 识别 */
export const WUPD_MAGIC = Buffer.from('WUPD', 'utf8');
export const WUPD_VERSION = 0x01;
