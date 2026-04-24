// 槽位级设备指纹 — per 技术交接文档 § 6 / § 7.1 / § 3.2
// 一个槽位建出来就要生成, 跨会话/重连保持稳定 (WA 对"同号在多设备"检测关联, 频繁漂移会触发风控).
// M2 用到: Baileys browser[0] = model label (出现在"已链接的设备"列表里)
// M9 接管 UI 会用到: UA / resolution / timezone (Puppeteer Chromium 模拟)
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getSlotDir } from './storage';

// 主流马来西亚市场在售的 Android 机型 (2023-2025). 每台出厂 UA 稳定,
// 不轮换. 换指纹等于换设备, 对 WA 反作弊更危险, 不能随机.
interface DeviceTemplate {
  brand: string;
  model: string;          // WA 链接设备列表显示的名字
  androidVersion: string;
  chromeVersion: string;
  resolution: readonly [number, number];
}

const DEVICE_POOL: readonly DeviceTemplate[] = [
  { brand: 'Samsung', model: 'Galaxy S23', androidVersion: '14', chromeVersion: '131.0.6778.135', resolution: [1080, 2340] },
  { brand: 'Samsung', model: 'Galaxy A54', androidVersion: '14', chromeVersion: '130.0.6723.102', resolution: [1080, 2340] },
  { brand: 'Samsung', model: 'Galaxy A34', androidVersion: '14', chromeVersion: '129.0.6668.101', resolution: [1080, 2340] },
  { brand: 'Xiaomi', model: 'Redmi Note 13 Pro', androidVersion: '13', chromeVersion: '131.0.6778.104', resolution: [1080, 2400] },
  { brand: 'Xiaomi', model: 'Redmi 13C', androidVersion: '13', chromeVersion: '130.0.6723.86', resolution: [720, 1600] },
  { brand: 'Xiaomi', model: 'POCO X6', androidVersion: '14', chromeVersion: '131.0.6778.135', resolution: [1080, 2400] },
  { brand: 'Oppo', model: 'Reno11', androidVersion: '14', chromeVersion: '131.0.6778.104', resolution: [1080, 2412] },
  { brand: 'Oppo', model: 'A78', androidVersion: '13', chromeVersion: '129.0.6668.101', resolution: [1080, 2400] },
  { brand: 'Vivo', model: 'Y27', androidVersion: '13', chromeVersion: '128.0.6613.90', resolution: [1080, 2408] },
  { brand: 'Vivo', model: 'V30', androidVersion: '14', chromeVersion: '131.0.6778.104', resolution: [1080, 2800] },
] as const;

export interface SlotFingerprint {
  generatedAt: string;       // ISO 8601, 创建时间
  brand: string;             // 厂商 e.g. Samsung
  model: string;             // 机型 e.g. Galaxy S23
  androidVersion: string;
  chromeVersion: string;
  userAgent: string;         // 完整 Chrome/Android UA, Puppeteer/接管 UI 用
  resolution: { width: number; height: number };
  timezone: string;          // Asia/Kuala_Lumpur 默认; 随 tenant country 扩展
  // 稳定随机种子, 跨会话保持, 未来 M5 深度指纹用
  seed: string;
  // Baileys browser 参数形式 — 直接可用
  baileysBrowser: [string, string, string]; // [deviceLabel, platform, appVersion]

  // 2026-04-25 · 稳定性 · baileys socket options per-slot 随机化
  // 防 WA 通过 "多 slot 同一 keepalive / timeout 模式" 关联识别
  // 种子稳定 · 同槽位同参数 (重连时指纹一致)
  baileysOpts: {
    connectTimeoutMs: number;       // 45-55 s
    keepAliveIntervalMs: number;    // 15-25 s
    defaultQueryTimeoutMs: number;  // 55-65 s
    emitOwnEvents: boolean;
    markOnlineOnConnect: boolean;
  };
}

function buildUserAgent(d: DeviceTemplate): string {
  return `Mozilla/5.0 (Linux; Android ${d.androidVersion}; ${d.model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${d.chromeVersion} Mobile Safari/537.36`;
}

function pickDeviceForSeed(seed: string): DeviceTemplate {
  // 稳定: 同 seed 永远选同一台
  const hash = crypto.createHash('sha256').update(seed).digest();
  const idx = hash[0] % DEVICE_POOL.length;
  return DEVICE_POOL[idx];
}

// 2026-04-25 · 从 seed 稳定派生 baileys options · 每 slot 独立参数 · 但重连不变
// 用 sha256(seed + 'baileys-opts') 的不同 byte 作为不同参数
function deriveBaileysOpts(seed: string): SlotFingerprint['baileysOpts'] {
  const h = crypto.createHash('sha256').update(`${seed}|baileys-opts`).digest();
  // 0-255 映射到 [min, max]
  const map = (byte: number, min: number, max: number) =>
    min + Math.round((byte / 255) * (max - min));
  return {
    connectTimeoutMs: map(h[0], 45_000, 55_000),       // 45-55s
    keepAliveIntervalMs: map(h[1], 15_000, 25_000),    // 15-25s
    defaultQueryTimeoutMs: map(h[2], 55_000, 65_000),  // 55-65s
    emitOwnEvents: (h[3] & 1) === 1,                   // 50/50
    markOnlineOnConnect: (h[4] & 1) === 1,             // 50/50
  };
}

/**
 * 生成一份指纹 (首次建槽位时用, 后续只读不覆盖)
 */
export function generateFingerprint(params: {
  slotIndex: number;
  tenantId: number;
  timezone?: string;
}): SlotFingerprint {
  // seed = sha256(tenantId|slotIndex|randomBytes) 保证稳定但不可预测
  const seed = crypto
    .createHash('sha256')
    .update(`${params.tenantId}|${params.slotIndex}|${crypto.randomBytes(16).toString('hex')}`)
    .digest('hex');
  const dev = pickDeviceForSeed(seed);
  const [w, h] = dev.resolution;

  // Baileys browser[0] 即 WA "已链接的设备"列表显示名.
  // 加 slotIndex 后缀: 保证多槽抽到同 DEVICE_POOL 条目也能被区分 (防 WA 识别"同一设备重复链接").
  const deviceLabel = `${dev.brand} ${dev.model} · S${params.slotIndex}`;

  return {
    generatedAt: new Date().toISOString(),
    brand: dev.brand,
    model: dev.model,
    androidVersion: dev.androidVersion,
    chromeVersion: dev.chromeVersion,
    userAgent: buildUserAgent(dev),
    resolution: { width: w, height: h },
    timezone: params.timezone ?? 'Asia/Kuala_Lumpur',
    seed,
    baileysBrowser: [deviceLabel, 'Desktop', dev.chromeVersion.split('.')[0]],
    baileysOpts: deriveBaileysOpts(seed),
  };
}

function fingerprintFilePath(slotIndex: number): string {
  return path.join(getSlotDir(slotIndex), 'fingerprint.json');
}

export function writeFingerprint(slotIndex: number, fp: SlotFingerprint): void {
  fs.writeFileSync(fingerprintFilePath(slotIndex), JSON.stringify(fp, null, 2), 'utf-8');
}

export function readFingerprint(slotIndex: number): SlotFingerprint | null {
  const p = fingerprintFilePath(slotIndex);
  if (!fs.existsSync(p)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as SlotFingerprint;
    // 2026-04-25 · 向后兼容 · 老指纹没有 baileysOpts · 从 seed 派生补齐
    if (!parsed.baileysOpts && parsed.seed) {
      parsed.baileysOpts = deriveBaileysOpts(parsed.seed);
      writeFingerprint(slotIndex, parsed);
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 保证槽位有指纹文件. 返回已存在的或新建的. 幂等.
 */
export function ensureFingerprint(params: {
  slotIndex: number;
  tenantId: number;
  timezone?: string;
}): SlotFingerprint {
  const existing = readFingerprint(params.slotIndex);
  if (existing) return existing;
  const fresh = generateFingerprint(params);
  writeFingerprint(params.slotIndex, fresh);
  return fresh;
}
