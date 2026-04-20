// M11 Preamble · 第三个 fp 文件 · Installer 硬件兼容性指纹
//
// 与 fp-license.txt / fp-master-key.txt 职责**正交**:
//   - fp-license.txt     License 绑定 · 稳定性要求**最高** · 32 hex · 过滤虚拟网卡
//   - fp-master-key.txt  AES 密钥派生 · 稳定性**中等** · 64 hex · 含硬件多维度
//   - fp-installer.txt   Installer 兼容性 · 稳定性**最低** · JSON · 粗粒度
//
// 用途 (M11 后续 installer 用):
//   - Installer 启动比对 `.wupd` manifest 的 `machine_compat` 字段
//   - 硬件变化 (比如 arch 从 x64 → arm64) → installer 警告 "此 .wupd 可能不兼容"
//   - **不做强制拒绝** · 让用户决定 (VPN 虚拟机 / wine 等合法场景)
//   - **不参与任何加密** · 纯信息报告
//
// 算法 · 粗粒度故意:
//   - arch              'x64' | 'arm64' | 'ia32' | ...
//   - osMajor           'win10' | 'win11' | 'macOS-14' | 'linux-6'   (主版本号)
//   - ramBucket         '8G' | '16G' | '32G' | '64G+'                 (向下取整到档位)
//   - createdAt         ISO 首次生成时刻
//   - installerVersion  '1.0' (算法版本 · 未来加字段升 '2.0')

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface InstallerFingerprint {
  arch: string;
  osMajor: string;
  ramBucket: string;
  createdAt: string;
  installerVersion: '1.0';
}

const FP_INSTALLER_VERSION: '1.0' = '1.0';

export function getFpInstallerFilePath(): string {
  const base = process.env.WAHUBX_DATA_DIR
    ? path.resolve(process.env.WAHUBX_DATA_DIR)
    : path.join(process.cwd(), 'data');
  const dir = path.join(base, 'config');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'fp-installer.txt');
}

/**
 * 从 os.platform() + os.release() 推导主版本标签
 *   Windows: major release code (10 = win10, 11 via 10.0.22000+)
 *   macOS: Darwin 版本 → macOS 年份
 *   Linux: 主内核
 */
export function deriveOsMajor(): string {
  const platform = os.platform();
  const release = os.release();
  if (platform === 'win32') {
    // release 如 '10.0.22000' · 22000+ 是 Win11 (微软文档)
    const build = parseInt(release.split('.')[2] || '0', 10);
    if (build >= 22000) return 'win11';
    if (release.startsWith('10.0')) return 'win10';
    if (release.startsWith('6.3')) return 'win8.1';
    return `win-${release}`;
  }
  if (platform === 'darwin') {
    // Darwin major → macOS 对照表 (常见值, 超出返 raw)
    const darwinMajor = parseInt(release.split('.')[0] || '0', 10);
    const macosMap: Record<number, string> = {
      23: 'macOS-14', // Sonoma
      22: 'macOS-13', // Ventura
      21: 'macOS-12', // Monterey
      20: 'macOS-11', // Big Sur
    };
    return macosMap[darwinMajor] ?? `darwin-${darwinMajor}`;
  }
  if (platform === 'linux') {
    const kernelMajor = release.split('.')[0] || '?';
    return `linux-${kernelMajor}`;
  }
  return `${platform}-${release}`;
}

/**
 * RAM 档位 (GB 向下取最近档)
 *   <6G → '4G' · 6-10 → '8G' · 10-20 → '16G' · 20-48 → '32G' · >=48 → '64G+'
 */
export function deriveRamBucket(totalBytes: number = os.totalmem()): string {
  const gb = totalBytes / 1024 ** 3;
  if (gb < 6) return '4G';
  if (gb < 10) return '8G';
  if (gb < 20) return '16G';
  if (gb < 48) return '32G';
  return '64G+';
}

export function computeInstallerFingerprint(): InstallerFingerprint {
  return {
    arch: os.arch(),
    osMajor: deriveOsMajor(),
    ramBucket: deriveRamBucket(),
    createdAt: new Date().toISOString(),
    installerVersion: FP_INSTALLER_VERSION,
  };
}

/**
 * 读已有 fp-installer.txt · 不存在则生成写入.
 * 返回当前硬件对比结果: { current, stored, matches }
 *   current  本次启动实测
 *   stored   文件里记录的 (可能是之前某次硬件)
 *   matches  arch+osMajor+ramBucket 三项**全**相同才 true
 *            (createdAt 不参与比较 · 那是时间戳)
 */
export function readOrCreateFpInstaller(): {
  current: InstallerFingerprint;
  stored: InstallerFingerprint;
  matches: boolean;
  wasFreshlyGenerated: boolean;
} {
  const fpPath = getFpInstallerFilePath();
  const current = computeInstallerFingerprint();
  if (!fs.existsSync(fpPath)) {
    fs.writeFileSync(fpPath, JSON.stringify(current, null, 2), 'utf-8');
    return { current, stored: current, matches: true, wasFreshlyGenerated: true };
  }
  let stored: InstallerFingerprint;
  try {
    stored = JSON.parse(fs.readFileSync(fpPath, 'utf-8'));
    if (!stored.arch || !stored.osMajor || !stored.installerVersion) {
      throw new Error('格式不完整');
    }
  } catch {
    // 损坏 · 重写
    fs.writeFileSync(fpPath, JSON.stringify(current, null, 2), 'utf-8');
    return { current, stored: current, matches: true, wasFreshlyGenerated: true };
  }
  const matches =
    stored.arch === current.arch &&
    stored.osMajor === current.osMajor &&
    stored.ramBucket === current.ramBucket;
  return { current, stored, matches, wasFreshlyGenerated: false };
}
