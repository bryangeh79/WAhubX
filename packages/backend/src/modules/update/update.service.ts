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

import { Injectable, Logger, Optional } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WupdManifest } from '../signing/types';
import { Ed25519VerifierService } from '../signing/ed25519-verifier.service';
import { BackupExportService } from '../backup/backup-export.service';
import { VersionService, type VersionCompat } from './version.service';
import {
  extractWupdPayload,
  parseWupdHeader,
  verifyAppSha256,
  verifyMigrations,
} from './wupd-codec';
import { assertNoStaleSignal, getStagingRoot, writeSignal } from './apply-signal';

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

  constructor(
    private readonly versionSvc: VersionService,
    private readonly verifier: Ed25519VerifierService,
    // Day 4 · @Optional 使单测无需注入
    @Optional() private readonly exportSvc?: BackupExportService,
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
   * M11 Day 4 · apply **prepare phase** · 不含 process.exit (Day 5 smoke 真装)
   *
   * 流程 (prepare · 不 kill backend):
   *   1. 再跑 preview 确认 can_apply (防中间状态改变)
   *   2. exportSvc.export({source: 'pre-update'}) · 备份当前全量到 backups/pre-update/
   *   3. assertNoStaleSignal · 若上次未完成则拒
   *   4. extractWupdPayload → 落盘到 staging/<ts>/ (app.tar + migrations/*.sql)
   *   5. writeSignal · installer 监测的 signal file
   *   6. 返 { code: 'PREPARED', signal_path, ... } · **不** process.exit
   *      Day 5 smoke · installer 外壳起来后加 process.exit 触发
   *
   * @param opts.dryRun 默认 false · true 时全跑 · 但**不**写 signal file (给 admin 测试用)
   */
  async apply(
    wupdBuf: Buffer,
    opts: { dryRun?: boolean } = {},
  ): Promise<
    | {
        code: 'PREPARED';
        staging_path: string;
        pre_update_wab_path: string | null;
        signal_path: string | null;
        manifest: WupdManifest;
        dry_run: boolean;
      }
    | { code: 'PREVIEW_REJECTED'; preview: PreviewResult }
    | { code: 'EXPORT_SVC_UNAVAILABLE'; message: string }
  > {
    const dryRun = opts.dryRun ?? false;
    this.logger.warn(`apply called · dryRun=${dryRun} · M11 Day 4 prepare phase`);

    // 1. preview
    const preview = await this.preview(wupdBuf);
    if (!preview.can_apply) {
      return { code: 'PREVIEW_REJECTED', preview };
    }
    const manifest = preview.manifest;

    // 2. assertNoStaleSignal
    assertNoStaleSignal();

    // 3. pre-update 备份
    if (!this.exportSvc) {
      return {
        code: 'EXPORT_SVC_UNAVAILABLE',
        message: 'BackupExportService 未注入 · apply 路径需要 M10 备份支持',
      };
    }
    let preUpdateWabPath: string | null = null;
    if (!dryRun) {
      const exp = await this.exportSvc.export({
        source: 'pre-update',
        notes: `pre-update snapshot · ${manifest.from_version} → ${manifest.to_version}`,
      });
      preUpdateWabPath = exp.filePath;
      this.logger.log(`pre-update.wab · ${exp.filePath} · ${exp.sizeBytes}B`);
    } else {
      this.logger.log('[dry-run] pre-update.wab skipped');
    }

    // 4. extract + 落 staging
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const stagingPath = path.join(getStagingRoot(), stamp);
    if (!fs.existsSync(stagingPath)) fs.mkdirSync(stagingPath, { recursive: true });

    const payload = await extractWupdPayload(wupdBuf);
    // 再 double-check sha (preview 已验过 · 多一次保险)
    if (!verifyAppSha256(payload.appTar, manifest.app_sha256)) {
      throw new Error('APPLY_ABORT · app.tar sha256 mismatch (second check) · 异常');
    }
    const migCheck = verifyMigrations(payload.migrations, manifest.migrations);
    if (!migCheck.ok) {
      throw new Error(`APPLY_ABORT · migrations mismatch · ${JSON.stringify(migCheck)}`);
    }

    if (!dryRun) {
      fs.writeFileSync(path.join(stagingPath, 'app.tar'), payload.appTar);
      const migDir = path.join(stagingPath, 'migrations');
      if (!fs.existsSync(migDir)) fs.mkdirSync(migDir, { recursive: true });
      for (const [name, buf] of payload.migrations) {
        fs.writeFileSync(path.join(migDir, `${name}.sql`), buf);
      }
      fs.writeFileSync(
        path.join(stagingPath, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
      );
      this.logger.log(`staging · ${stagingPath}`);
    }

    // 5. signal file
    let signalPath: string | null = null;
    if (!dryRun) {
      signalPath = writeSignal({
        staging_path: stagingPath,
        pre_update_wab_path: preUpdateWabPath!,
        old_app_rename_to: path.resolve(stagingPath, '..', `app-old-${stamp}`),
        manifest,
      });
      this.logger.warn(
        `apply signal 写入 · installer 外壳监测 · ${signalPath} · ` +
        `Day 5 smoke 该 signal 触发 installer 接管 + backend 自杀重启`,
      );
    }

    return {
      code: 'PREPARED',
      staging_path: stagingPath,
      pre_update_wab_path: preUpdateWabPath,
      signal_path: signalPath,
      manifest,
      dry_run: dryRun,
    };
  }
}
