// 改自 FAhubX/backend/src/modules/license/machine-id.util.ts
// 基于物理 MAC 地址 + CPU 型号算 SHA-256 前 32 字符.
// 首次计算后写入 data/config/machine-fingerprint.txt, 之后永远读文件,
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

function getMachineIdFilePath(): string {
  // 生产: C:\WAhubX\data\config\machine-fingerprint.txt
  // 开发: <cwd>/data/config/machine-fingerprint.txt
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
  return path.join(configDir, 'machine-fingerprint.txt');
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
 */
export function getMachineId(): string {
  const filePath = getMachineIdFilePath();
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
