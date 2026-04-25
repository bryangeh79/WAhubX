// 2026-04-25 · D12-1 · Runtime 启动配置抽象 (Codex 锁定 6 边界)
//
// 范围 (Codex 锁):
//   ✓ OS detect
//   ✓ data dir 路径规则
//   ✓ Chromium executable 定位 (env 显式 + Windows 自动探测)
//   ✓ proxy/config 归一化 · DNS 策略文档化
//   ✓ 输出 RuntimeLaunchConfig 给 runtime + backend 共用
//
// 不在范围 (D12-2/D12-3 才做):
//   ✗ child_process.spawn
//   ✗ 进程生命周期管理
//   ✗ auto-spawn active slots
//   ✗ respawn / quarantine
//
// 长期规则 (Codex 边界 3 · 一旦定就不改):
//   Windows production: %APPDATA%\wahubx\slots\<slotIndex>\
//   Linux dev:          /app/wa-data         (Docker container · 当前 D6 路径)
//   Linux dev (host):   <cwd>/data/slots/<slotIndex>/  (本地跑非 docker)
//
// DNS 策略 (Codex 边界 4 · 不假承诺):
//   Linux Docker: iptables-hard (NET_ADMIN cap + iptables OUTPUT 53 DROP · 跟 SOCKS5h)
//   Windows:      chromium-soft (--host-resolver-rules + --disable-features=AsyncDns,DnsOverHttps)
//                 不等同于 Linux 硬封 · 文档要写明 (代理是必须 + 文档约束)
//   none:         无 proxy 直连 · 测试用 · 生产警告

import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

export type RuntimeOs = 'win32' | 'linux' | 'darwin';
export type DnsStrategy = 'iptables-hard' | 'chromium-soft' | 'none';

export interface RuntimeLaunchConfig {
  /** 当前 OS · process.platform */
  os: RuntimeOs;
  // ─── 身份 ────────────────────────────────────────
  slotId: number;
  slotIndex: number;
  tenantId: number;
  // ─── 路径 (Codex 边界 3 · 长期规则) ────────────────
  /** slot 数据根目录 · profile + diagnostics 在下面 */
  dataDir: string;
  /** Chromium user-data-dir · = dataDir/profile */
  profileDir: string;
  /** 诊断证据落盘 · = dataDir/diagnostics */
  diagnosticsDir: string;
  // ─── Chromium (Codex 边界 5) ──────────────────────
  /** 解析出来的 Chromium 可执行路径 · env 优先 · Windows 自动探测兜底 */
  chromiumExecutablePath: string;
  /** 是否检测到了真实 Chromium 文件 (false = 路径只是占位 · 启动会失败) */
  chromiumExecutableExists: boolean;
  // ─── 网络 ────────────────────────────────────────
  /** 代理 URL · null = 直连 */
  proxyUrl: string | null;
  /** 代理鉴权 · http/https proxy 才用 (SOCKS auth 走 URL) */
  proxyAuth: { user: string; pass: string } | null;
  /** 显式国家代码 (env PROXY_COUNTRY) · 不设走 ipinfo 探测 */
  proxyCountry: string | null;
  /** DNS 防泄漏策略 (Codex 边界 4 · 文档化) */
  dnsStrategy: DnsStrategy;
  // ─── 反检测 (D7 系列已用) ────────────────────────
  userAgent: string;
  // ─── WS bridge ──────────────────────────────────
  /** backend 控制面 WS endpoint · 不设 = standalone (D6 测) */
  controlPlaneWsUrl: string | null;
  runtimeAuthToken: string;
  // ─── 模式开关 (D7-1) ────────────────────────────
  soakMode: boolean;
  humanBehaviorEnabled: boolean;
  // ─── QR 调试 ──────────────────────────────────────
  qrLiveServerEnabled: boolean;
  qrLiveServerPort: number;
  // ─── 元 ──────────────────────────────────────────
  resolvedAt: string;
  /** 解析路上的非致命警告 · backend / UI 可显 */
  warnings: string[];
}

/**
 * 解析 RuntimeLaunchConfig 的输入 · 通常来自 process.env
 * backend 调时也可显式传 (绕过 env)
 */
export interface RuntimeLaunchInput {
  slotId?: string | number;
  slotIndex?: string | number;
  tenantId?: string | number;
  /** 不设走默认 (Windows: %APPDATA%\wahubx\slots · Linux container: /app/wa-data · Linux host: cwd/data) */
  sessionDir?: string;
  proxyUrl?: string;
  proxyUser?: string;
  proxyPass?: string;
  proxyCountry?: string;
  /** 显式 chromium 路径 · 不设 D12-1 自动探测 */
  puppeteerExecutablePath?: string;
  userAgent?: string;
  controlPlaneWsUrl?: string;
  runtimeAuthToken?: string;
  soakMode?: boolean | string;
  humanBehaviorEnabled?: boolean | string;
  qrLiveServer?: boolean | string;
  qrLivePort?: number | string;
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const DEFAULT_USER_AGENT_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

// Windows 常见 Chromium / Chrome 安装路径 (Codex 边界 5 · 探测顺序固定)
const WINDOWS_CHROMIUM_CANDIDATES = [
  // Inno Setup 装的我们自带 Chromium (D13 会走这条 · 优先)
  'C:\\WAhubX\\chromium\\chrome.exe',
  'C:\\Program Files\\WAhubX\\chromium\\chrome.exe',
  // 系统 Google Chrome
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  // Microsoft Edge (Chromium-based · 兜底)
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

// Linux 常见路径
const LINUX_CHROMIUM_CANDIDATES = [
  '/usr/bin/chromium',          // Debian apt chromium · D6 docker 当前用这个
  '/usr/bin/chromium-browser',  // Ubuntu
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
];

const DARWIN_CHROMIUM_CANDIDATES = [
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome.app/Contents/Google Chrome',
];

/**
 * 解析数据根目录 · 跟 OS 绑定 (Codex 边界 3)
 */
function resolveDataRoot(rtOs: RuntimeOs): string {
  // 显式 env 覆盖 (跟 backend storage.ts 的 WAHUBX_DATA_DIR 兼容)
  const envOverride = process.env.WAHUBX_DATA_DIR;
  if (envOverride) return path.resolve(envOverride);

  if (rtOs === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) {
      return path.join(appData, 'wahubx');
    }
    // fallback Windows 但没 APPDATA · 极少见
    return path.join(os.homedir(), 'AppData', 'Roaming', 'wahubx');
  }

  if (rtOs === 'linux') {
    // D6 Docker 容器内 · /app/wa-data 由 init.sh + VOLUME 创建
    if (fs.existsSync('/app/wa-data')) return '/app';
    // Linux host (非 docker) · 跟 backend storage.ts 一样: cwd/data
    return path.join(process.cwd(), 'data');
  }

  // darwin · dev only
  return path.join(os.homedir(), 'Library', 'Application Support', 'wahubx');
}

/**
 * slot data dir · 路径规则 (Codex 边界 3 · 长期不改):
 *   Windows: %APPDATA%\wahubx\slots\<slotIndex>\
 *   Linux container (existing /app/wa-data): /app/wa-data/  (per-slot 已是容器视角的 root)
 *   Linux host: <cwd>/data/slots/<slotIndex>/
 */
function resolveSlotDataDir(rtOs: RuntimeOs, slotIndex: number, sessionDirOverride?: string): string {
  if (sessionDirOverride) return path.resolve(sessionDirOverride);
  const root = resolveDataRoot(rtOs);
  // Linux container 特例: /app/wa-data 整个就是当前 slot 的根 (一容器一 slot · 不分子目录)
  if (rtOs === 'linux' && root === '/app') return '/app/wa-data';
  // 其他: <root>/slots/<slotIndex>/
  const idxPadded = String(slotIndex).padStart(2, '0');
  return path.join(root, 'slots', idxPadded);
}

/**
 * 探测 Chromium 可执行路径 (Codex 边界 5)
 * 顺序: env 显式 > 平台 candidates 找第一个 exists > fallback (返路径但 exists=false)
 */
function resolveChromiumExecutable(
  rtOs: RuntimeOs,
  envOverride: string | undefined,
): { path: string; exists: boolean } {
  if (envOverride && envOverride.trim()) {
    const p = path.resolve(envOverride.trim());
    return { path: p, exists: fs.existsSync(p) };
  }
  const candidates =
    rtOs === 'win32'
      ? WINDOWS_CHROMIUM_CANDIDATES
      : rtOs === 'linux'
      ? LINUX_CHROMIUM_CANDIDATES
      : DARWIN_CHROMIUM_CANDIDATES;
  for (const c of candidates) {
    if (fs.existsSync(c)) return { path: c, exists: true };
  }
  // fallback · 返第一个 candidate · 调用方按 exists=false 处理 (warn / fail)
  return { path: candidates[0] ?? '', exists: false };
}

/**
 * 决定 DNS 策略 (Codex 边界 4)
 *   Linux + iptables 可用 (容器内 NET_ADMIN cap) → iptables-hard
 *   Windows → chromium-soft (Chromium --host-resolver-rules + AsyncDns disable)
 *   其他 → none
 */
function resolveDnsStrategy(rtOs: RuntimeOs, hasProxy: boolean): DnsStrategy {
  if (rtOs === 'linux' && hasProxy) return 'iptables-hard';
  if (rtOs === 'win32' && hasProxy) return 'chromium-soft';
  return 'none';
}

function asBool(v: boolean | string | undefined, defaultVal = false): boolean {
  if (v === undefined) return defaultVal;
  if (typeof v === 'boolean') return v;
  return v === 'true' || v === '1' || v === 'yes';
}

function asInt(v: number | string | undefined, defaultVal: number): number {
  if (v === undefined) return defaultVal;
  if (typeof v === 'number') return v;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : defaultVal;
}

/**
 * 主 resolver · 输入 env 风格的 input · 输出强类型 RuntimeLaunchConfig
 */
export function resolveRuntimeLaunchConfig(input: RuntimeLaunchInput = {}): RuntimeLaunchConfig {
  const warnings: string[] = [];
  const rtOs = (process.platform as RuntimeOs) || 'linux';

  // 身份
  const slotIdNum = asInt(input.slotId, 0);
  const slotIndexNum = asInt(input.slotIndex, slotIdNum); // 不设回退到 slotId
  const tenantIdNum = asInt(input.tenantId, 0);
  if (slotIdNum <= 0) warnings.push('slotId 未设或非法 · 默认 0');
  if (slotIndexNum <= 0) warnings.push('slotIndex 未设或非法 · 默认 0');

  // 路径
  const dataDir = resolveSlotDataDir(rtOs, slotIndexNum, input.sessionDir);
  const profileDir = path.join(dataDir, 'profile');
  const diagnosticsDir = path.join(dataDir, 'diagnostics');

  // Chromium 路径
  const chromium = resolveChromiumExecutable(rtOs, input.puppeteerExecutablePath);
  if (!chromium.exists) {
    warnings.push(
      `Chromium 可执行未找到 · path="${chromium.path}" · 启动前必须显式 PUPPETEER_EXECUTABLE_PATH` +
        (rtOs === 'win32' ? ' · 或装 D13 Inno Setup 包 (含 Chromium)' : ''),
    );
  }

  // 代理
  const proxyUrl = input.proxyUrl?.trim() || null;
  const proxyAuth =
    input.proxyUser && input.proxyPass
      ? { user: input.proxyUser, pass: input.proxyPass }
      : null;
  const proxyCountry = input.proxyCountry?.trim().toUpperCase() || null;

  // DNS 策略
  const dnsStrategy = resolveDnsStrategy(rtOs, !!proxyUrl);
  if (rtOs === 'win32' && !proxyUrl) {
    warnings.push(
      'Windows 无代理直连 · 出口 = 本机 IP · WA 看到的 IP/UA 不一致风险高 · 生产建议必配代理',
    );
  }
  if (rtOs === 'win32' && proxyUrl) {
    warnings.push(
      'Windows DNS 策略 = chromium-soft · 仅 Chromium 进程内防泄漏 · ' +
        '不是 Linux iptables 硬封 · 文档约束: 代理必填 + 不允用户层走系统 DNS',
    );
  }

  // UA · 跨 OS 适配
  const ua = input.userAgent?.trim() || (rtOs === 'win32' ? DEFAULT_USER_AGENT_WIN : DEFAULT_USER_AGENT);

  return {
    os: rtOs,
    slotId: slotIdNum,
    slotIndex: slotIndexNum,
    tenantId: tenantIdNum,
    dataDir,
    profileDir,
    diagnosticsDir,
    chromiumExecutablePath: chromium.path,
    chromiumExecutableExists: chromium.exists,
    proxyUrl,
    proxyAuth,
    proxyCountry,
    dnsStrategy,
    userAgent: ua,
    controlPlaneWsUrl: input.controlPlaneWsUrl?.trim() || null,
    runtimeAuthToken: input.runtimeAuthToken?.trim() || 'dev-runtime-token',
    soakMode: asBool(input.soakMode, false),
    humanBehaviorEnabled: asBool(input.humanBehaviorEnabled, true),
    qrLiveServerEnabled: asBool(input.qrLiveServer, true),
    qrLiveServerPort: asInt(input.qrLivePort, 9701),
    resolvedAt: new Date().toISOString(),
    warnings,
  };
}

/**
 * 从 process.env 读所有相关 env 包成 input · 简化 runtime 调用
 */
export function resolveRuntimeLaunchConfigFromEnv(): RuntimeLaunchConfig {
  return resolveRuntimeLaunchConfig({
    slotId: process.env.SLOT_ID,
    slotIndex: process.env.SLOT_INDEX, // 不设回退 slotId
    tenantId: process.env.TENANT_ID,
    sessionDir: process.env.SESSION_DIR,
    proxyUrl: process.env.PROXY_URL,
    proxyUser: process.env.PROXY_USER,
    proxyPass: process.env.PROXY_PASS,
    proxyCountry: process.env.PROXY_COUNTRY,
    puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    userAgent: process.env.USER_AGENT,
    controlPlaneWsUrl: process.env.CONTROL_PLANE_WS_URL,
    runtimeAuthToken: process.env.RUNTIME_AUTH_TOKEN,
    soakMode: process.env.SOAK_MODE,
    humanBehaviorEnabled: process.env.HUMAN_BEHAVIOR_ENABLED !== 'false', // default true
    qrLiveServer: process.env.QR_LIVE_SERVER,
    qrLivePort: process.env.QR_LIVE_PORT,
  });
}
