// M11 Day 3 · UpdateService · .wupd preview + apply
//
// Day 3 scope:
//   - previewUpd(buffer)  完整 · 返 manifest + 签名状态 + 版本兼容 + sha256 验证
//   - applyUpd(buffer)    **Day 3 skeleton only** · 返 501 · Day 4 真实装 (需 installer 外壳)
//
// apply 完整流程 (Day 4):
//   1. previewUpd · 任一失败拒
//   2. BackupExportService pre-update 备份 (复用 M10 · source='pre-migration' 暂借, Day 4 换成 pre-update)
//   3. extractWupdPayload · 落盘 app.tar + migrations/
//   4. 写 signal file /tmp/wahubx-apply-update.json · installer 外壳监测 · 自行原子替换 app/
//   5. backend 进程退出 (process.exit(0)) · installer 收 exit → 开始 rename 流程
//   6. 新 backend 起 · TypeORM 跑新 migrations · Y2+ error log file 机制
//   7. installer 检 /health · 失败从 pre-update.wab restore + rename back

import { Injectable, Logger } from '@nestjs/common';
import type { WupdManifest } from '../signing/types';
import { Ed25519VerifierService } from '../signing/ed25519-verifier.service';
import { VersionService, type VersionCompat } from './version.service';
import { extractWupdPayload, parseWupdHeader, verifyAppSha256, verifyMigrations } from './wupd-codec';

export interface PreviewResult {
  manifest: WupdManifest;
  file_bytes: number;
  /** Ed25519 verify · false 时 · 给 UI 明确原因 */
  signature_valid: boolean;
  signature_fail_code?: string;
  signature_fail_message?: string;
  /** 版本兼容 · ok / same / downgrade / major-bump */
  version_compat: VersionCompat;
  version_compat_reason: string;
  /** app.tar 与 manifest.app_sha256 的 sha256 匹配 · 签名过一次不够 · 这里再验内容 */
  app_content_valid: boolean;
  /** migrations 数量与 sha256 全匹配? */
  migrations_valid: boolean;
  migrations_issues?: {
    missing: string[];
    mismatch: string[];
  };
  /** 是否可继续 apply (所有 check 通过) */
  can_apply: boolean;
}

@Injectable()
export class UpdateService {
  private readonly logger = new Logger(UpdateService.name);

  // Day 4 会加 @Optional @Inject(BackupExportService) 做 pre-update snapshot
  constructor(
    private readonly versionSvc: VersionService,
    private readonly verifier: Ed25519VerifierService,
  ) {}

  /**
   * 完整 preview · 不动任何持久化状态
   * 签名 + 版本 + app sha256 + migrations sha256 四项 check
   */
  async preview(wupdBuf: Buffer): Promise<PreviewResult> {
    // 1. parse header
    const header = parseWupdHeader(wupdBuf);
    const manifest = header.manifest;

    // 2. Ed25519 签名验证
    const sigResult = this.verifier.verify(manifest, {
      allowDevPlaceholder: process.env.NODE_ENV !== 'production',
    });
    const sigValid = sigResult.ok;

    // 3. 版本兼容判断
    const compat = this.versionSvc.assessCompat(manifest.from_version, manifest.to_version);

    // 4. app + migrations sha256 验 (需 extract · 可能慢 · 但 preview 需完整结果)
    let appValid = false;
    let migrationsValid = false;
    let migrationsIssues: { missing: string[]; mismatch: string[] } | undefined;
    try {
      const payload = await extractWupdPayload(wupdBuf);
      appValid = verifyAppSha256(payload.appTar, manifest.app_sha256);
      const mResult = verifyMigrations(payload.migrations, manifest.migrations);
      migrationsValid = mResult.ok;
      if (!mResult.ok) {
        migrationsIssues = { missing: mResult.missing, mismatch: mResult.mismatch };
      }
    } catch (err) {
      this.logger.warn(`preview · extract failed: ${err instanceof Error ? err.message : err}`);
      // appValid/migrationsValid 保 false
    }

    const canApply =
      sigValid && appValid && migrationsValid &&
      (compat.compat === 'ok' || compat.compat === 'major-bump');

    return {
      manifest,
      file_bytes: wupdBuf.length,
      signature_valid: sigValid,
      signature_fail_code: sigValid ? undefined : (sigResult as { code?: string }).code,
      signature_fail_message: sigValid ? undefined : (sigResult as { message?: string }).message,
      version_compat: compat.compat,
      version_compat_reason: compat.reason,
      app_content_valid: appValid,
      migrations_valid: migrationsValid,
      migrations_issues: migrationsIssues,
      can_apply: canApply,
    };
  }

  /**
   * Day 3 · apply 仅骨架 · 返 NOT_IMPLEMENTED · Day 4 补真逻辑
   *
   * Day 4 TODO:
   *   1. 再跑 preview 确认可升级
   *   2. 调 exportSvc.export({source: 'pre-migration', notes: 'pre-update ...'}) · 或新 'pre-update' source
   *   3. extractWupdPayload → 落 staging/app.tar + staging/migrations/
   *   4. 写 signal file 'C:\\WAhubX\\updates\\staging\\apply.signal.json'
   *      installer 外壳监测 · 自行替换 app/ + rename
   *   5. process.exit(0) · backend 退出 · installer 接管
   */
  async apply(_wupdBuf: Buffer): Promise<{ code: 'NOT_IMPLEMENTED'; message: string }> {
    this.logger.warn('apply() called · M11 Day 3 skeleton · Day 4 才真实装');
    return {
      code: 'NOT_IMPLEMENTED',
      message:
        'M11 Day 3 skeleton · apply 需 installer 外壳配合 (原子 rename app/ · backend 自杀重启). Day 4 + Day 5 smoke 后解锁.',
    };
  }
}
