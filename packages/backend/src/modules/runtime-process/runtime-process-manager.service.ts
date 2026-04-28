// 2026-04-25 · D12-2 · per-slot Runtime 进程管理 (Codex 锁定 6 边界)
//
// 范围:
//   ✓ start(slotId) · stop(slotId) · getProcessState(slotId) · listAll
//   ✓ 单实例约束 (Codex 边界 2): 已存在 handle 直接返回当前状态 · 不替换
//   ✓ stdout/stderr/exit 转 backend pino · 带 slotId/pid tag (边界 3)
//   ✓ 退出分类 normal-stop / spawn-failed / unexpected-exit (边界 4)
//   ✓ 启动目标先支持 dev 形态 (node + dist entry · 边界 5)
//
// 不在范围:
//   ✗ bind/send/inbound 业务语义 (走 RuntimeBridgeService · 不揉一起 · 边界 1)
//   ✗ auto-respawn / quarantine / 状态机自愈 (D12-3+)
//   ✗ active slot 自动启动 (D12-3)
//
// Windows spawn 注意 (Codex 实现建议):
//   ✓ executable + args 数组分开传 · 不自己拼整条 command string
//   ✓ windowsHide: true · 不弹 console window

import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { ChildProcess, spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { DataSource } from 'typeorm';
import { resolveRuntimeLaunchConfig, type RuntimeLaunchConfig } from '@wahubx/shared';
import {
  AccountSlotEntity,
  AccountSlotStatus,
} from '../slots/account-slot.entity';
import { ProxyEntity } from '../proxies/proxy.entity';
import {
  type ProcessState,
  type ProcessExitClass,
  initialProcessState,
} from './process-state';

interface ProcessHandle {
  state: ProcessState;
  child: ChildProcess | null;
  /** stop() 已发 · 用于 close 事件分类 */
  stopRequested: boolean;
  /** C1 · auto-respawn 计数 · 滑动窗口 */
  respawnAttempts: number;
  respawnWindowStartAt: number;
  /** quarantine 期间禁再 respawn · 60s 后解 */
  quarantinedUntil: number;
  respawnTimer: NodeJS.Timeout | null;
}

@Injectable()
export class RuntimeProcessManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RuntimeProcessManagerService.name);
  private readonly handles = new Map<number, ProcessHandle>();
  // D12-3 · 防 onModuleInit 期间业务调 start (会走 race · 单实例约束兜底)
  private autoSpawnInProgress = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  // 2026-04-25 · D12-3 · backend 启动后 auto-spawn 符合条件的 active slot
  // (Codex 锁 6 边界 · 严格不越界)
  async onModuleInit(): Promise<void> {
    const enabled = this.config.get<string>('AUTO_SPAWN_ON_BOOT', 'true');
    if (enabled === 'false') {
      this.logger.log('D12-3 auto-spawn disabled · AUTO_SPAWN_ON_BOOT=false');
      return;
    }
    // 不阻塞 onModuleInit · 异步起 (DB 还在初始化时 onModuleInit 顺序可能未完)
    setTimeout(() => {
      void this.autoSpawnActiveSlots();
    }, 2_000);
  }

  async onModuleDestroy(): Promise<void> {
    // 进程退出时把所有子进程也收掉 · 不留孤儿 (Codex 边界 5 · best-effort)
    const slots = Array.from(this.handles.keys());
    this.logger.log(`onModuleDestroy · stopping ${slots.length} runtime processes (best-effort)`);
    await Promise.all(slots.map((s) => this.stop(s, { graceful: true, timeoutMs: 5_000 }).catch(() => {})));
  }

  /**
   * D12-3 · 判定一个 slot 是否要 backend 启动时自动拉起
   * (Codex 边界 2 · 保守集合)
   */
  private shouldAutoStart(slot: AccountSlotEntity): boolean {
    // 必须已绑账号
    if (!slot.accountId) return false;
    // 2026-04-28 · 用户决策: 所有绑定号都常驻 chromium runtime · 不再分角色
    //   - 老规则: 只 customer_service 常驻 · broadcast 号 lazy-spawn
    //   - 新规则: 任何 status=active/warmup 的绑定号都 backend 启动时 auto-spawn
    //   - 代价: 内存 ×N 倍 (每号 ~600MB-1GB chromium) · 但用户明确接受
    //   - 收益: 接管/广告/养号 都即点即用 · 不用等 lazy-spawn 5-15s
    // 状态必须在线集合 · empty/quarantine/suspended 排除
    if (
      slot.status !== AccountSlotStatus.Active &&
      slot.status !== AccountSlotStatus.Warmup
    ) {
      return false;
    }
    // 冷却期内的 suspended 不拉
    if (slot.suspendedUntil && slot.suspendedUntil > new Date()) {
      return false;
    }
    return true;
  }

  /**
   * D12-3 · 扫所有 slot · 符合条件的 stagger 启动
   * Codex 边界 3: 一个一个起 · 间隔 3-10s · 不并发风暴
   * Codex 边界 4: 单 slot 起不来只 log · 不影响别人
   */
  private async autoSpawnActiveSlots(): Promise<void> {
    if (this.autoSpawnInProgress) return;
    this.autoSpawnInProgress = true;
    try {
      const allSlots = await this.dataSource.getRepository(AccountSlotEntity).find();
      const eligible = allSlots.filter((s) => this.shouldAutoStart(s));
      this.logger.log(
        `D12-3 auto-spawn scan · 总 ${allSlots.length} 个 slot · 符合条件 ${eligible.length} 个`,
      );

      if (eligible.length === 0) {
        this.logger.log('D12-3 auto-spawn · 无符合条件 slot · 跳');
        return;
      }

      // stagger 间隔 (Codex 边界 3): 默认 5s · env 可调 · 范围 3-30s
      const intervalRaw = this.config.get<string>('AUTO_SPAWN_INTERVAL_MS', '5000');
      const interval = Math.max(3_000, Math.min(30_000, parseInt(intervalRaw, 10) || 5_000));
      this.logger.log(`D12-3 auto-spawn 间隔 ${interval}ms · 启动顺序 = slot id ASC`);

      for (let i = 0; i < eligible.length; i++) {
        const slot = eligible[i];
        const order = `${i + 1}/${eligible.length}`;
        this.logger.log(
          `D12-3 auto-spawn ${order} · slot ${slot.id} (tenant=${slot.tenantId} idx=${slot.slotIndex} role=${slot.role})`,
        );
        try {
          const state = await this.start(slot.id);
          this.logger.log(
            `D12-3 auto-spawn ${order} · slot ${slot.id} · result=${state.status} pid=${state.pid ?? '?'}`,
          );
        } catch (err) {
          // Codex 边界 4: 单 slot 起不来 · log + 继续 · 不重试不升级
          this.logger.error(
            { err: err instanceof Error ? err.message : err, slotId: slot.id },
            `D12-3 auto-spawn ${order} · slot ${slot.id} 启动失败 · 跳 · 继续下一个`,
          );
        }
        // 最后一个不等
        if (i < eligible.length - 1) {
          await new Promise((r) => setTimeout(r, interval));
        }
      }
      this.logger.log(`D12-3 auto-spawn 完成 · 处理 ${eligible.length} 个 slot`);
    } finally {
      this.autoSpawnInProgress = false;
    }
  }

  // ═══ 公共 API ════════════════════════════════════════════════════

  /**
   * 启动 runtime 进程 (per-slot · Codex 边界 2 单实例约束)
   * @returns 当前 ProcessState · running / starting / failed
   */
  async start(slotId: number): Promise<ProcessState> {
    // 单实例: 已存在 handle 且仍 running/starting → 直接返
    const existing = this.handles.get(slotId);
    if (existing && (existing.state.status === 'running' || existing.state.status === 'starting')) {
      this.logger.log(
        `slot ${slotId} runtime already ${existing.state.status} · pid=${existing.state.pid} · 返当前 state`,
      );
      return { ...existing.state };
    }

    // 拉 slot + 关联 proxy
    const slotRepo = this.dataSource.getRepository(AccountSlotEntity);
    const slot = await slotRepo.findOne({ where: { id: slotId } });
    if (!slot) {
      throw new NotFoundException(`slot ${slotId} 不存在`);
    }

    let proxy: ProxyEntity | null = null;
    if (slot.proxyId) {
      proxy = await this.dataSource
        .getRepository(ProxyEntity)
        .findOne({ where: { id: slot.proxyId } });
    }

    // 解析 RuntimeLaunchConfig
    const cfg = resolveRuntimeLaunchConfig({
      slotId: slot.id,
      slotIndex: slot.slotIndex,
      tenantId: slot.tenantId,
      proxyUrl: proxy ? this.buildProxyUrl(proxy) : undefined,
      proxyUser: proxy?.username ?? undefined,
      proxyPass: proxy?.password ?? undefined,
      proxyCountry: proxy?.country ?? undefined,
      controlPlaneWsUrl: this.config.get<string>('CONTROL_PLANE_WS_URL_FOR_RUNTIME')
        ?? this.buildDefaultBridgeUrl(),
      runtimeAuthToken: this.config.get<string>('RUNTIME_AUTH_TOKEN', 'dev-runtime-token'),
      // soakMode/humanBehavior 暂不在 ProcessManager 控 · runtime 自己 env 读
    });

    if (!cfg.chromiumExecutableExists) {
      this.logger.error(
        `slot ${slotId} · Chromium 可执行路径不存在 (${cfg.chromiumExecutablePath}) · spawn-failed`,
      );
      const failedHandle = this.upsertHandle(slotId);
      failedHandle.state.status = 'failed';
      failedHandle.state.exitClass = 'spawn-failed';
      failedHandle.state.lastError = `Chromium not found: ${cfg.chromiumExecutablePath}`;
      return { ...failedHandle.state };
    }

    // 解析 runtime entry 路径
    const entryPath = this.resolveRuntimeEntry();
    if (!fs.existsSync(entryPath)) {
      this.logger.error(`runtime entry 不存在 · ${entryPath} · spawn-failed`);
      const failedHandle = this.upsertHandle(slotId);
      failedHandle.state.status = 'failed';
      failedHandle.state.exitClass = 'spawn-failed';
      failedHandle.state.lastError = `runtime entry missing: ${entryPath}`;
      return { ...failedHandle.state };
    }

    // 构造 env (Codex 实现建议: executable + args 分开 · 不拼 command string)
    const childEnv = this.buildChildEnv(cfg);
    // 2026-04-26 · P0.10++ ship · 全 slot headless (无桌面 chrome 窗口)
    // 接管走 P0.10++ CDP screencast · canvas in 5173 · 不再依赖 bringToFront 外部窗口
    // 用户不会再误关桌面 chrome (因为根本不显示)

    const handle = this.upsertHandle(slotId);
    handle.state.status = 'starting';
    handle.state.startAttempts += 1;
    handle.state.lastError = null;
    // D12-2 · 重置上轮 exit 信息 (防上次 'spawn-failed' 被 classifyExit 保留)
    handle.state.exitClass = 'never-started';
    handle.state.exitCode = null;
    handle.state.exitSignal = null;
    handle.state.stoppedAt = null;
    handle.state.pid = null;
    handle.state.startedAt = null;
    handle.stopRequested = false;

    this.logger.log(
      `slot ${slotId} · spawn runtime · entry=${entryPath} · exe=${cfg.chromiumExecutablePath} · attempt=${handle.state.startAttempts}`,
    );

    let child: ChildProcess;
    try {
      child = spawn(process.execPath, [entryPath], {
        env: childEnv,
        cwd: path.dirname(entryPath),
        // pipe stdio · 我们要转发日志
        stdio: ['ignore', 'pipe', 'pipe'],
        // Windows 不弹 console window
        windowsHide: true,
        // 不 detached · 父进程退就把子进程也带走
        detached: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: msg }, `slot ${slotId} · spawn 调用失败`);
      handle.state.status = 'failed';
      handle.state.exitClass = 'spawn-failed';
      handle.state.lastError = msg;
      handle.child = null;
      return { ...handle.state };
    }

    handle.child = child;
    this.wireChildEvents(handle);
    return { ...handle.state };
  }

  /**
   * 停止 runtime 进程 (graceful 默认)
   * graceful=true → SIGTERM 等 timeoutMs 没退就 SIGKILL
   * graceful=false → 直接 SIGKILL
   */
  async stop(
    slotId: number,
    opts: { graceful?: boolean; timeoutMs?: number } = {},
  ): Promise<ProcessState> {
    const handle = this.handles.get(slotId);
    if (!handle) {
      return initialProcessState(slotId);
    }
    if (handle.state.status === 'stopped' || handle.state.status === 'failed') {
      return { ...handle.state };
    }
    const graceful = opts.graceful ?? true;
    const timeoutMs = opts.timeoutMs ?? 10_000;
    const child = handle.child;
    if (!child || child.killed || child.exitCode !== null) {
      handle.state.status = 'stopped';
      return { ...handle.state };
    }

    handle.stopRequested = true;
    handle.state.status = 'stopping';
    this.logger.log(
      `slot ${slotId} · stop · pid=${child.pid} · graceful=${graceful} · timeoutMs=${timeoutMs}`,
    );

    if (!graceful) {
      child.kill('SIGKILL');
    } else {
      child.kill('SIGTERM');
      // 超时后 SIGKILL
      const force = setTimeout(() => {
        if (handle.child && !handle.child.killed) {
          this.logger.warn(`slot ${slotId} · graceful 超时 ${timeoutMs}ms · SIGKILL`);
          handle.child.kill('SIGKILL');
        }
      }, timeoutMs);
      // 等 close
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (handle.state.status === 'stopped' || handle.state.status === 'failed') {
            clearInterval(checkInterval);
            clearTimeout(force);
            resolve();
          }
        }, 100);
      });
    }
    return { ...handle.state };
  }

  /**
   * 2026-04-28 · purge · 完全清掉某 slot 在内存里的所有痕迹
   * 用于 clear() 恢复出厂 · 防 handle 残留导致 stale state
   * 顺序: 取消 respawn timer · 删 Map entry · 关闭可能的子进程 (best-effort)
   */
  purgeSlot(slotId: number): void {
    const handle = this.handles.get(slotId);
    if (!handle) return;
    if (handle.respawnTimer) {
      clearTimeout(handle.respawnTimer);
      handle.respawnTimer = null;
    }
    if (handle.child && !handle.child.killed) {
      try {
        handle.child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
    this.handles.delete(slotId);
    this.logger.log(`slot ${slotId} · purgeSlot · 内存 handle 清掉 (clear 触发)`);
  }

  /**
   * 拉某 slot 当前状态 · 不存在则返 initial
   */
  getProcessState(slotId: number): ProcessState {
    const handle = this.handles.get(slotId);
    return handle ? { ...handle.state } : initialProcessState(slotId);
  }

  /**
   * 列出所有 slot 当前进程状态 · 用于 admin 诊断
   */
  listAll(): ProcessState[] {
    return Array.from(this.handles.values()).map((h) => ({ ...h.state }));
  }

  /**
   * D12-3 · 手动触发 auto-spawn (admin 调试用 · onModuleInit 也走这个)
   */
  async triggerAutoSpawn(): Promise<{ scanned: number; eligible: number; started: number }> {
    const allSlots = await this.dataSource.getRepository(AccountSlotEntity).find();
    const eligible = allSlots.filter((s) => this.shouldAutoStart(s));
    let started = 0;
    for (const slot of eligible) {
      try {
        const state = await this.start(slot.id);
        if (state.status === 'running' || state.status === 'starting') started += 1;
      } catch {
        /* ignore · 继续 */
      }
      // 间隔 3s (manual trigger 比 boot 快一点)
      await new Promise((r) => setTimeout(r, 3_000));
    }
    return { scanned: allSlots.length, eligible: eligible.length, started };
  }

  // ═══ private ═════════════════════════════════════════════════════

  private upsertHandle(slotId: number): ProcessHandle {
    let handle = this.handles.get(slotId);
    if (!handle) {
      handle = {
        state: initialProcessState(slotId),
        child: null,
        stopRequested: false,
        respawnAttempts: 0,
        respawnWindowStartAt: 0,
        quarantinedUntil: 0,
        respawnTimer: null,
      };
      this.handles.set(slotId, handle);
    }
    return handle;
  }

  private wireChildEvents(handle: ProcessHandle): void {
    const child = handle.child;
    if (!child) return;
    const slotId = handle.state.slotId;

    child.on('spawn', () => {
      handle.state.status = 'running';
      handle.state.pid = child.pid ?? null;
      handle.state.startedAt = Date.now();
      this.logger.log(`slot ${slotId} · runtime spawned · pid=${child.pid}`);
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      this.forwardLog('stdout', slotId, child.pid ?? null, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      this.forwardLog('stderr', slotId, child.pid ?? null, chunk);
    });

    child.on('error', (err) => {
      // spawn 之前的失败 (e.g. ENOENT)
      this.logger.error({ err: err.message }, `slot ${slotId} · child error`);
      if (handle.state.status === 'starting') {
        handle.state.status = 'failed';
        handle.state.exitClass = 'spawn-failed';
        handle.state.lastError = err.message;
      } else {
        handle.state.lastError = err.message;
      }
    });

    child.on('close', (code, signal) => {
      handle.state.exitCode = code;
      handle.state.exitSignal = signal;
      handle.state.stoppedAt = Date.now();
      handle.child = null;

      const exitClass = this.classifyExit(handle, code, signal);
      handle.state.exitClass = exitClass;
      handle.state.status = exitClass === 'normal-stop' ? 'stopped' : 'failed';
      this.logger.log(
        `slot ${slotId} · runtime closed · pid=${handle.state.pid} · code=${code} signal=${signal} · class=${exitClass}`,
      );

      // 2026-04-28 · C1 · auto-respawn unexpected-exit
      // 窗口内 3 次以内立刻重启 (1s/3s/10s 退避) · 第 4 次起 60s quarantine
      if (exitClass === 'unexpected-exit') {
        this.scheduleAutoRespawn(slotId, handle);
      }
    });
  }

  private scheduleAutoRespawn(slotId: number, handle: ProcessHandle): void {
    const now = Date.now();
    if (handle.quarantinedUntil > now) {
      this.logger.warn(
        `slot ${slotId} · auto-respawn 跳 · quarantined for ${Math.ceil((handle.quarantinedUntil - now) / 1000)}s`,
      );
      return;
    }
    // 滑动窗口 5min · 超出重置计数
    if (now - handle.respawnWindowStartAt > 300_000) {
      handle.respawnAttempts = 0;
      handle.respawnWindowStartAt = now;
    }
    handle.respawnAttempts += 1;
    const backoffMs = handle.respawnAttempts === 1 ? 1_000 : handle.respawnAttempts === 2 ? 3_000 : 10_000;
    if (handle.respawnAttempts > 3) {
      handle.quarantinedUntil = now + 60_000;
      this.logger.error(
        `slot ${slotId} · C1 auto-respawn · 已 ${handle.respawnAttempts} 次连退 · quarantine 60s`,
      );
      return;
    }
    this.logger.warn(
      `slot ${slotId} · C1 auto-respawn 调度 · attempt=${handle.respawnAttempts} · backoff=${backoffMs}ms`,
    );
    if (handle.respawnTimer) clearTimeout(handle.respawnTimer);
    handle.respawnTimer = setTimeout(() => {
      handle.respawnTimer = null;
      this.start(slotId).catch((err) => {
        this.logger.error(
          `slot ${slotId} · C1 auto-respawn 启失败 · ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, backoffMs);
  }

  private classifyExit(
    handle: ProcessHandle,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): ProcessExitClass {
    // 'spawn-failed' 已在 'error' handler 里设过的不要被覆盖
    if (handle.state.exitClass === 'spawn-failed') return 'spawn-failed';
    // 用户调过 stop · 不论 code 都算 normal-stop
    if (handle.stopRequested) return 'normal-stop';
    // 进程自己 exit 0 · 也算 normal-stop (graceful self-shutdown)
    if (code === 0) return 'normal-stop';
    // 其他: 没人 stop · 但进程死了 = unexpected
    return 'unexpected-exit';
  }

  /**
   * 转发子进程 stdout/stderr · 加 tag · pino 统一打 (Codex 边界 3)
   */
  private forwardLog(
    stream: 'stdout' | 'stderr',
    slotId: number,
    pid: number | null,
    chunk: Buffer,
  ): void {
    const text = chunk.toString('utf-8').trim();
    if (!text) return;
    // 多行 split · 每行一条 log
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // runtime 自己已用 pino · stdout 是 JSON 行 · 我们原样 forward (Codex 边界 3 · 不重组)
      if (stream === 'stderr') {
        this.logger.warn(`[runtime slot=${slotId} pid=${pid ?? '?'}] ${trimmed}`);
      } else {
        this.logger.log(`[runtime slot=${slotId} pid=${pid ?? '?'}] ${trimmed}`);
      }
    }
  }

  private buildChildEnv(cfg: RuntimeLaunchConfig): NodeJS.ProcessEnv {
    // 把 cfg 投影到 env vars · runtime 启动会再调 resolveRuntimeLaunchConfigFromEnv
    // 这样保 backend / runtime 用同一份 resolver
    const env: NodeJS.ProcessEnv = {
      ...process.env, // 继承 PATH 等
      // D12-2 · 强制 production · 让 runtime 跳过 pino-pretty transport (devDep 在 spawn 子进程里 resolve 失败)
      // 跟 D6 Dockerfile 同款 (ENV NODE_ENV=production)
      NODE_ENV: 'production',
      SLOT_ID: String(cfg.slotId),
      SLOT_INDEX: String(cfg.slotIndex),
      TENANT_ID: String(cfg.tenantId),
      SESSION_DIR: cfg.dataDir,
      PUPPETEER_EXECUTABLE_PATH: cfg.chromiumExecutablePath,
      USER_AGENT: cfg.userAgent,
      RUNTIME_AUTH_TOKEN: cfg.runtimeAuthToken,
    };
    // D12-2 · Windows 跳 integrity-checks (iptables 不存在) · D12-3+ 改为按 cfg.dnsStrategy 动态跳
    // Linux Docker 仍跑全套检查 (iptables-hard 路径)
    if (cfg.os === 'win32') env.SKIP_INTEGRITY_CHECKS = 'true';
    if (cfg.proxyUrl) env.PROXY_URL = cfg.proxyUrl;
    if (cfg.proxyAuth) {
      env.PROXY_USER = cfg.proxyAuth.user;
      env.PROXY_PASS = cfg.proxyAuth.pass;
    }
    if (cfg.proxyCountry) env.PROXY_COUNTRY = cfg.proxyCountry;
    if (cfg.controlPlaneWsUrl) env.CONTROL_PLANE_WS_URL = cfg.controlPlaneWsUrl;
    if (cfg.soakMode) env.SOAK_MODE = 'true';
    if (!cfg.humanBehaviorEnabled) env.HUMAN_BEHAVIOR_ENABLED = 'false';
    if (!cfg.qrLiveServerEnabled) env.QR_LIVE_SERVER = 'false';
    // 2026-04-26 · multi-slot 修 EADDRINUSE 9701 · QR live server 端口按 slotIndex 偏移
    // base port = cfg.qrLiveServerPort (默认 9701) · slotIndex=1→9701, 2→9702, 3→9703...
    // 不动 cfg.qrLiveServerPort 字段 (那是 base port · 用户可全局覆盖)
    const perSlotQrPort = cfg.qrLiveServerPort + Math.max(0, cfg.slotIndex - 1);
    env.QR_LIVE_PORT = String(perSlotQrPort);
    return env;
  }

  /**
   * 拉 runtime entry 路径 (Codex 边界 5: 先 dev 形态 · D13 加 bundle 路径)
   * 优先级:
   *   1. env RUNTIME_ENTRY_PATH
   *   2. workspace 同级 · 相对 backend dist/main.js 推算
   *   3. 兜底警告
   */
  private resolveRuntimeEntry(): string {
    const envOverride = this.config.get<string>('RUNTIME_ENTRY_PATH');
    if (envOverride) return path.resolve(envOverride);
    // backend dist/main.js · runtime 在同 monorepo · 相对位置:
    //   <root>/packages/backend/dist/main.js
    //   <root>/packages/runtime-chromium/dist/index.js
    const backendDist = path.dirname(require.main?.filename ?? '');
    const candidate = path.resolve(backendDist, '..', '..', 'runtime-chromium', 'dist', 'index.js');
    return candidate;
  }

  /**
   * 把 ProxyEntity 投到 URL · 复用现 proxy-config 风格
   */
  private buildProxyUrl(proxy: ProxyEntity): string {
    // proxy_type: http | socks5 | socks4 | https
    const scheme = proxy.proxyType === 'socks5' || proxy.proxyType === 'socks4' ? proxy.proxyType : 'http';
    return `${scheme}://${proxy.host}:${proxy.port}`;
  }

  /**
   * 没显式 CONTROL_PLANE_WS_URL_FOR_RUNTIME 时 · 拼默认值
   * Linux Docker: 走 host.docker.internal (要 --add-host)
   * Windows native: 走 127.0.0.1 (D12-3 后两边都走 native · 这里默认 localhost)
   */
  private buildDefaultBridgeUrl(): string {
    const port = this.config.get<string>('RUNTIME_BRIDGE_PORT', '9711');
    const host = process.platform === 'linux' ? 'host.docker.internal' : '127.0.0.1';
    return `ws://${host}:${port}/runtime`;
  }
}
