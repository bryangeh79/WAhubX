// M11 Day 3 · 当前版本 + fp-installer 信息
//
// 用途:
//   - Admin UI 升级 Tab 顶部显示
//   - /version/verify-upd 判 from_version 匹配

import { Injectable, Logger } from '@nestjs/common';
import { readOrCreateFpInstaller } from '../licenses/fp-installer.util';

export interface CurrentVersionInfo {
  app_version: string;
  installer_fp: {
    arch: string;
    osMajor: string;
    ramBucket: string;
    createdAt: string;
  };
}

export type VersionCompat = 'ok' | 'same' | 'downgrade' | 'major-bump';

@Injectable()
export class VersionService {
  private readonly logger = new Logger(VersionService.name);
  private cached: CurrentVersionInfo | null = null;

  /** 缓存 · 进程生命期 · 版本号不变 */
  getCurrent(): CurrentVersionInfo {
    if (this.cached) return this.cached;
    const appVersion = this.resolveAppVersion();
    const fp = readOrCreateFpInstaller();
    this.cached = {
      app_version: appVersion,
      installer_fp: {
        arch: fp.current.arch,
        osMajor: fp.current.osMajor,
        ramBucket: fp.current.ramBucket,
        createdAt: fp.stored.createdAt,
      },
    };
    this.logger.log(
      `current version · ${appVersion} · ${fp.current.arch}/${fp.current.osMajor}/${fp.current.ramBucket}`,
    );
    return this.cached;
  }

  /**
   * 比对 from/to 与 current · 返兼容性判断 (Z1 SemVer strict)
   *
   * 规则:
   *   - from !== current → incompat (升级包不适用此机器)
   *   - to < current (SemVer) → downgrade · 拒
   *   - to === current → same · 无需升级
   *   - to > current · MAJOR 升 (0.x → 1.0 / 1.x → 2.0) → 'major-bump' · UI 额外确认
   *   - 其他 (PATCH / MINOR 升) → 'ok'
   */
  assessCompat(from: string, to: string): {
    from_matches_current: boolean;
    current: string;
    compat: VersionCompat;
    reason: string;
  } {
    const current = this.getCurrent().app_version;
    const fromMatches = normalizeVer(from) === normalizeVer(current);
    if (!fromMatches) {
      return {
        from_matches_current: false,
        current,
        compat: 'downgrade', // 非适用 · 统一作 downgrade 拒 (也可单独 error code, 简化为 downgrade 给 UI)
        reason: `.wupd from_version=${from} 与当前 ${current} 不匹配 · 需找适配当前版本的 .wupd`,
      };
    }
    const cmp = semverCompare(to, current);
    if (cmp === 0) {
      return {
        from_matches_current: true,
        current,
        compat: 'same',
        reason: '目标版本与当前相同 · 无需升级',
      };
    }
    if (cmp < 0) {
      return {
        from_matches_current: true,
        current,
        compat: 'downgrade',
        reason: `不支持降级 ${current} → ${to} · V1 永不做降级 · 如需恢复旧版请 restore .wab`,
      };
    }
    // cmp > 0 · 判 MAJOR bump
    const curMajor = parseSemver(current).major;
    const toMajor = parseSemver(to).major;
    if (toMajor > curMajor) {
      return {
        from_matches_current: true,
        current,
        compat: 'major-bump',
        reason: `MAJOR 升级 ${curMajor}.x → ${toMajor}.x · 数据模型可能重大变更 · 建议先手动 .wab 备份`,
      };
    }
    return {
      from_matches_current: true,
      current,
      compat: 'ok',
      reason: `PATCH/MINOR 升级 ${current} → ${to} · 自动安全`,
    };
  }

  /** 读 package.json 或 fallback env */
  private resolveAppVersion(): string {
    const fromEnv = process.env.npm_package_version;
    if (fromEnv) return fromEnv;
    try {
      // dist 里的 package.json 可能缺 · 退到 backend/package.json 读
      const path = require('node:path') as typeof import('node:path');
      const fs = require('node:fs') as typeof import('node:fs');
      const candidate = path.resolve(process.cwd(), 'package.json');
      if (fs.existsSync(candidate)) {
        const pkg = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
        if (pkg.version) return pkg.version;
      }
    } catch {
      // ignore
    }
    return '0.0.0-unknown';
  }
}

// ── SemVer 解析 (strict · 忽略 pre-release · V1 简化) ──
export function parseSemver(v: string): { major: number; minor: number; patch: number; pre: string } {
  // 去掉 pre-release suffix 算核心 · 比较时独立处理 pre
  // 支持 '0.11.0-m11' · '1.0.0' · 'v0.10.0'
  const clean = v.replace(/^v/i, '');
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(clean);
  if (!match) return { major: 0, minor: 0, patch: 0, pre: clean };
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    pre: match[4] ?? '',
  };
}

export function normalizeVer(v: string): string {
  const p = parseSemver(v);
  return `${p.major}.${p.minor}.${p.patch}${p.pre ? '-' + p.pre : ''}`;
}

/** -1 a<b · 0 equal · 1 a>b · 简化 pre-release 对比 · m11 > m10 按字符串 */
export function semverCompare(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  // pre-release: 无 pre > 有 pre (e.g. 1.0.0 > 1.0.0-beta) · 但此项目 pre = m 数字后缀
  if (pa.pre === pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}
