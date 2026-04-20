// 改自 FAhubX/backend/src/modules/license/machine-id.util.ts
// 基于物理 MAC 地址 + CPU 型号算 SHA-256 前 32 字符.
//
// M11 Preamble · fp 命名统一:
//   - 当前用 data/config/fp-license.txt (M11 起)
//   - 向后兼容: 若 data/config/machine-fingerprint.txt 仍存在 (M1-M10 遗留),
//     首次读 → 复制到新名 → 删旧名 (一次性原子迁移)
//   - 6 个月后 V1.1 可删 fallback 分支
//
// 首次计算后写入, 之后永远读文件,
// 避免网络适配器变化 (新插 USB 网卡 / VPN 虚拟网卡 / 重启 Bluetooth) 导致指纹漂移.
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const VIRTUAL_NIC_PATTERNS = [
  'vmware',
  'virtualbox',
  'vbox',
  'tap-',
  'tun',
  'vethernet',
  'bluetooth',
  'loopback',
  'pseudo',
  'docker',
  'wsl',
  'hyperv',
];

// M11 · 新命名
function getMachineIdFilePath(): string {
  // 生产: C:\WAhubX\data\config\fp-license.txt
  // 开发: <cwd>/data/config/fp-license.txt
  // 允许 env 覆盖
  const override = process.env.WAHUBX_MACHINE_ID_FILE;
  if (override) return override;

  const base = process.env.WAHUBX_DATA_DIR
    ? path.resolve(process.env.WAHUBX_DATA_DIR)
    : path.join(process.cwd(), 'data');
  const configDir = path.join(base, 'config');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  return path.join(configDir, 'fp-license.txt');
}

// M11 · 旧名 · 向后兼容 fallback (V1.1 可删)
function getLegacyMachineIdFilePath(): string {
  const override = process.env.WAHUBX_MACHINE_ID_FILE;
  if (override) return ''; // env 覆盖时不处理 legacy
  const base = process.env.WAHUBX_DATA_DIR
    ? path.resolve(process.env.WAHUBX_DATA_DIR)
    : path.join(process.cwd(), 'data');
  return path.join(base, 'config', 'machine-fingerprint.txt');
}

/**
 * M11 · 旧名 → 新名一次性迁移
 * 调用前提: 新名不存在. 若旧名存在 → rename · 返 true 表示迁移成功
 */
function migrateLegacyIfAny(newPath: string): boolean {
  if (fs.existsSync(newPath)) return false; // 新名已在 · 不动
  const legacy = getLegacyMachineIdFilePath();
  if (!legacy || !fs.existsSync(legacy)) return false; // 无旧文件
  try {
    const content = fs.readFileSync(legacy, 'utf-8').trim();
    if (!/^[0-9a-f]{32}$/.test(content)) return false; // 格式不对 · 不迁移 · 保留原文件让用户人工检查
    fs.writeFileSync(newPath, content, 'utf-8');
    fs.unlinkSync(legacy);
    return true;
  } catch {
    return false;
  }
}

function computeMachineId(): string {
  const parts: string[] = [];
  const interfaces = os.networkInterfaces();

  for (const name of Object.keys(interfaces).sort()) {
    const lower = name.toLowerCase();
    if (VIRTUAL_NIC_PATTERNS.some((p) => lower.includes(p))) continue;
    const nets = interfaces[name];
    if (!nets) continue;
    for (const net of nets) {
      if (net.mac && net.mac !== '00:00:00:00:00:00' && !net.internal) {
        parts.push(net.mac);
      }
    }
  }

  // 全部虚拟接口过滤掉时的 fallback
  if (parts.length === 0) parts.push(os.hostname());

  const cpus = os.cpus();
  if (cpus.length > 0) parts.push(cpus[0].model);

  const raw = parts.join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
}

/**
 * 获取本机稳定指纹. 首次调用写入文件, 之后永远读文件.
 * 返回 32 字符小写 hex.
 *
 * M11 · 若旧名 `machine-fingerprint.txt` 存在而新名不存在 → 自动迁移
 */
export function getMachineId(): string {
  const filePath = getMachineIdFilePath();

  // M11 · fallback 迁移一次
  migrateLegacyIfAny(filePath);

  try {
    if (fs.existsSync(filePath)) {
      const saved = fs.readFileSync(filePath, 'utf-8').trim();
      if (/^[0-9a-f]{32}$/.test(saved)) return saved;
    }
  } catch {
    // 读取失败则重新算
  }

  const fresh = computeMachineId();
  try {
    fs.writeFileSync(filePath, fresh, 'utf-8');
  } catch {
    // 写入失败不影响返回
  }
  return fresh;
}
