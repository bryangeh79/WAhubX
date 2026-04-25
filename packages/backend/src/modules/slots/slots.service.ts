import {
  ConflictException,
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import * as fs from 'node:fs';
import { AccountSlotEntity, AccountSlotStatus, AccountSlotRole } from './account-slot.entity';
import { WaAccountEntity } from './wa-account.entity';
import { TenantEntity } from '../tenants/tenant.entity';
import { ProxyEntity } from '../proxies/proxy.entity';
import type { SlotResponseDto } from './dto/slot-response.dto';
import { BaileysService } from '../baileys/baileys.service';
import { SlotRuntimeRegistry } from '../slot-runtime/slot-runtime.registry';
import { getSlotDir } from '../../common/storage';
import { ensureFingerprint } from '../../common/fingerprint';
import { writeProxyConf, type ProxyDescriptor } from '../../common/proxy-config';
import { getTelcoById, getCountry } from '../../data/telco-registry';

// 2026-04-21 · toResponse 需要的 per-account 聚合数据
interface AccountSideStats {
  warmupStartedAt: string | null;
  warmupCurrentDay: number;
  warmupPhase: number | null;
  tasksExecuted: number;
  contactsCount: number;
  channelsCount: number;
  groupsCount: number;
  simInfo: SlotSimInfoView | null;
}

// 2026-04-22 · 传给前端的 SIM 视图 (含新字段 + 合成的展示字符串)
export interface SlotSimInfoView {
  countryCode?: string | null;
  carrierId?: string | null;
  customCarrierName?: string | null;
  customCountryName?: string | null;
  iccidSuffix?: string | null;
  notes?: string | null;
  displayCarrier?: string | null;
  displayCountry?: string | null;
  // 旧字段 (向后兼容)
  iccid?: string | null;
  carrier?: string | null;
  country?: string | null;
}

@Injectable()
export class SlotsService {
  private readonly logger = new Logger(SlotsService.name);

  constructor(
    @InjectRepository(AccountSlotEntity)
    private readonly slotRepo: Repository<AccountSlotEntity>,
    @InjectRepository(WaAccountEntity)
    private readonly accountRepo: Repository<WaAccountEntity>,
    @InjectRepository(ProxyEntity)
    private readonly proxyRepo: Repository<ProxyEntity>,
    @Inject(forwardRef(() => BaileysService))
    private readonly baileys: BaileysService,
    private readonly dataSource: DataSource,
    // 2026-04-25 · D9-4 · 通过 Registry 选 runtime 实装 · 替 D8-3 直接 inject
    private readonly runtimes: SlotRuntimeRegistry,
  ) {}

  // 2026-04-25 · D9-4 · bind facade · 走 Registry · backend 不再到处写 if chromium / if baileys
  // (Codex 边界 6: 单一 runtime 协议来源 · bind/status/send 抽象层成立)

  async bindStartBind(slotId: number, pairingPhoneNumber?: string): Promise<unknown> {
    return this.runtimes.current().startBind(slotId, pairingPhoneNumber);
  }

  async bindCancelBind(slotId: number): Promise<unknown> {
    return this.runtimes.current().cancelBind(slotId);
  }

  bindGetStatus(slotId: number): unknown {
    const status = this.runtimes.current().getBindStatus(slotId);
    // 兼容老前端字段: 加上 runtime/connected 别名 (D14 收敛)
    if (status && typeof (status as { then?: unknown }).then === 'function') {
      // 异步返回 (理论上 ISlotRuntime.getBindStatus 同步 · 但允许 Promise)
      return status;
    }
    return {
      runtime: this.runtimes.getCurrentMode(),
      ...status,
    };
  }

  // ═══ 2026-04-25 · D11-1 · slot 角色管理 (Codex 锁定 5 边界) ═══════
  // 边界 1: 唯一 customer_service 必须 backend 硬约束 · 不靠 UI

  /**
   * 拉某 tenant 的客服号槽位 · 没设过则 null
   */
  async getCustomerServiceSlot(tenantId: number): Promise<AccountSlotEntity | null> {
    return this.slotRepo.findOne({
      where: { tenantId, role: AccountSlotRole.CustomerService },
    });
  }

  /**
   * 切换 slot 的 role · backend 硬校验
   *
   * 规则:
   *   broadcast → customer_service
   *     · 必须先确认该 tenant 没有别的 customer_service · 否则拒
   *     · partial unique index 也兜底 · 但 service 层先抛友好错
   *   customer_service → broadcast
   *     · 允许 · 但建议 UI 提示 "切完该 tenant 没客服号了"
   *
   * Codex 边界 1: backend 校验为主 · UI 校验为辅
   */
  async setRole(
    slotId: number,
    requesterTenantId: number | null,
    targetRole: AccountSlotRole,
  ): Promise<AccountSlotEntity> {
    const slot = await this.slotRepo.findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException(`槽位 ${slotId} 不存在`);

    // 租户隔离 (平台超管 tenantId=null 跳过)
    if (requesterTenantId !== null && slot.tenantId !== requesterTenantId) {
      throw new ForbiddenException(`槽位 ${slotId} 不属于当前租户`);
    }

    if (slot.role === targetRole) {
      // 没变 · 幂等返
      return slot;
    }

    if (targetRole === AccountSlotRole.CustomerService) {
      // 检查该 tenant 是否已有客服号
      const existing = await this.getCustomerServiceSlot(slot.tenantId);
      if (existing && existing.id !== slot.id) {
        // D11-2 (Codex 边界 ②): 用 ConflictException + 明确 code · 前端按 code 派发
        throw new ConflictException({
          code: 'CUSTOMER_SERVICE_EXISTS',
          message:
            `租户已有客服号 (槽位 #${existing.slotIndex}) · 每租户至多 1 个客服号 · ` +
            `请先把该槽位改回 broadcast`,
          existingSlotIndex: existing.slotIndex,
          existingSlotId: existing.id,
        });
      }
    }

    // 切 role
    slot.role = targetRole;
    await this.slotRepo.save(slot);
    this.logger.log(
      `slot ${slotId} role · ${slot.role} → ${targetRole} (tenant ${slot.tenantId})`,
    );
    return slot;
  }

  /**
   * 2026-04-21 · 一次性聚合多个 account 的 stats (防 N+1)
   * 给 listForTenant 用
   */
  private async loadStatsForAccounts(accountIds: number[]): Promise<Map<number, AccountSideStats>> {
    const result = new Map<number, AccountSideStats>();
    if (accountIds.length === 0) return result;

    const qr = this.dataSource;

    // warmup_plan
    const warmups: Array<{ account_id: number; started_at: Date; current_phase: number; current_day: number }> =
      await qr.query(
        `SELECT account_id, started_at, current_phase, current_day FROM warmup_plan WHERE account_id = ANY($1::int[])`,
        [accountIds],
      );

    // 2026-04-22 · "任务" 数改为 "实际参与的动作数"
    // 包含:
    //   - task_run.account_id 作为主 executor 的次数 (每 run 记 1)
    //   - chat_message.direction='out' 的发消息数 (作为 B 参与剧本也算)
    // 这样自动聊天的 B 号不会显 0
    const taskCounts: Array<{ account_id: number; cnt: string }> =
      await qr.query(
        `SELECT acc AS account_id, COUNT(*)::text AS cnt
         FROM (
           SELECT account_id AS acc FROM task_run WHERE account_id = ANY($1::int[])
           UNION ALL
           SELECT account_id AS acc FROM chat_message
           WHERE account_id = ANY($1::int[]) AND direction='out'
         ) x
         GROUP BY acc`,
        [accountIds],
      );

    // wa_contact · 按 JID 后缀分 · 个人 s.whatsapp.net / 群 @g.us / 频道 @newsletter
    const contactStats: Array<{ account_id: number; kind: string; cnt: string }> =
      await qr.query(
        `SELECT account_id,
           CASE
             WHEN remote_jid LIKE '%@g.us' THEN 'group'
             WHEN remote_jid LIKE '%@newsletter' THEN 'channel'
             ELSE 'contact'
           END AS kind,
           COUNT(*)::text AS cnt
         FROM wa_contact
         WHERE account_id = ANY($1::int[])
         GROUP BY account_id, kind`,
        [accountIds],
      );

    // sim_info (2026-04-22 · 扩字段 · 新 country_code/carrier_id/custom_*/iccid_suffix)
    const sims: Array<{
      account_id: number;
      carrier: string | null;
      registered_name: string | null;
      country_code: string | null;
      carrier_id: string | null;
      custom_carrier_name: string | null;
      custom_country_name: string | null;
      iccid_suffix: string | null;
      notes: string | null;
    }> = await qr.query(
      `SELECT account_id, carrier, registered_name, country_code, carrier_id,
              custom_carrier_name, custom_country_name, iccid_suffix, notes
         FROM sim_info WHERE account_id = ANY($1::int[])`,
      [accountIds],
    );

    // 组装
    const warmupMap = new Map(warmups.map((w) => [w.account_id, w]));
    const taskMap = new Map(taskCounts.map((t) => [t.account_id, parseInt(t.cnt, 10)]));
    const simMap = new Map(sims.map((s) => [s.account_id, s]));

    for (const id of accountIds) {
      const w = warmupMap.get(id);
      const sim = simMap.get(id);
      const stats: AccountSideStats = {
        warmupStartedAt: w?.started_at ? new Date(w.started_at).toISOString() : null,
        warmupCurrentDay: w?.current_day ?? 0,
        warmupPhase: w?.current_phase ?? null,
        tasksExecuted: taskMap.get(id) ?? 0,
        contactsCount: 0,
        channelsCount: 0,
        groupsCount: 0,
        simInfo: sim ? buildSimInfoView(sim) : null,
      };
      result.set(id, stats);
    }

    for (const c of contactStats) {
      const s = result.get(c.account_id);
      if (!s) continue;
      const n = parseInt(c.cnt, 10);
      if (c.kind === 'group') s.groupsCount = n;
      else if (c.kind === 'channel') s.channelsCount = n;
      else s.contactsCount = n;
    }

    return result;
  }

  // ── 初始化: 租户激活时调用, 预填 N 条 empty 槽位 ──────────────
  // 用 EntityManager 参数, 方便 license.activate() 在同一事务里复用
  async seedForTenant(manager: EntityManager, tenantId: number, slotLimit: number): Promise<void> {
    const existing = await manager.count(AccountSlotEntity, { where: { tenantId } });
    if (existing > 0) {
      this.logger.warn(`Tenant ${tenantId} already has ${existing} slots, skipping seed`);
      return;
    }

    // 读 tenant 的 timezone 给 fingerprint 用
    const tenant = await manager.findOne(TenantEntity, { where: { id: tenantId } });
    const tz = tenant?.timezone ?? 'Asia/Kuala_Lumpur';

    // D11-1 · 首槽 (slotIndex=1) = customer_service · 其余 broadcast (Codex 边界 1)
    const rows = Array.from({ length: slotLimit }, (_, i) =>
      manager.create(AccountSlotEntity, {
        tenantId,
        slotIndex: i + 1,
        accountId: null,
        status: AccountSlotStatus.Empty,
        proxyId: null,
        persona: null,
        profilePath: null,
        role: i === 0 ? AccountSlotRole.CustomerService : AccountSlotRole.Broadcast,
      }),
    );
    await manager.save(AccountSlotEntity, rows);

    // 技术交接文档 § 6: 槽位一建出来 data/slots/<N>/fingerprint.json 就存在
    // 稳定不漂移 (跨重连/重启保持), 不同 slot 落不同 model (DEVICE_POOL 抽)
    for (let i = 1; i <= slotLimit; i++) {
      ensureFingerprint({ slotIndex: i, tenantId, timezone: tz });
    }
    this.logger.log(`Seeded ${slotLimit} empty slots + fingerprints for tenant ${tenantId}`);
  }

  // 已存在的槽位 (活数据) 补 fingerprint — 用于升级后一次性回填, 幂等.
  // 既补 fingerprint.json 文件, 也把 JSON 内容写回 wa_account.device_fingerprint DB 列
  // (老版本 binding 时 DB 列为 null, 新版本 binding 会填).
  async backfillFingerprintsForTenant(tenantId: number): Promise<{ fsWritten: number; dbUpdated: number }> {
    const slots = await this.slotRepo.find({ where: { tenantId }, relations: ['account'] });
    const tenant = await this.slotRepo.manager.findOne(TenantEntity, { where: { id: tenantId } });
    const tz = tenant?.timezone ?? 'Asia/Kuala_Lumpur';
    let fsWritten = 0;
    let dbUpdated = 0;
    for (const s of slots) {
      const before = fs.existsSync(`${getSlotDir(s.slotIndex)}/fingerprint.json`);
      const fp = ensureFingerprint({ slotIndex: s.slotIndex, tenantId, timezone: tz });
      if (!before) fsWritten++;

      // 如果该槽位有绑定账号且 device_fingerprint 为空, 回填
      if (s.accountId && s.account && !s.account.deviceFingerprint) {
        const patch = { deviceFingerprint: fp as unknown } as Parameters<typeof this.accountRepo.update>[1];
        await this.accountRepo.update(s.accountId, patch);
        dbUpdated++;
      }
    }
    this.logger.log(`Backfill tenant=${tenantId}: fsWritten=${fsWritten}, dbUpdated=${dbUpdated}`);
    return { fsWritten, dbUpdated };
  }

  // ── 查询 (带 tenant 隔离) ────────────────────────────────────
  async listForTenant(tenantId: number): Promise<SlotResponseDto[]> {
    const slots = await this.slotRepo.find({
      where: { tenantId },
      relations: ['account'],
      order: { slotIndex: 'ASC' },
    });
    const accountIds = slots.map((s) => s.accountId).filter((x): x is number => x !== null);
    const statsMap = await this.loadStatsForAccounts(accountIds);
    return slots.map((s) => this.toResponse(s, s.accountId ? statsMap.get(s.accountId) : undefined));
  }

  async findOne(id: number, requesterTenantId: number | null): Promise<SlotResponseDto> {
    const slot = await this.slotRepo.findOne({
      where: { id },
      relations: ['account'],
    });
    if (!slot) throw new NotFoundException(`槽位 ${id} 不存在`);
    this.assertCanAccess(slot, requesterTenantId);
    const stats = slot.accountId
      ? (await this.loadStatsForAccounts([slot.accountId])).get(slot.accountId)
      : undefined;
    return this.toResponse(slot, stats);
  }

  // ── clear: 置空槽位 (M2 W2 实装完整 FS + 在线 socket 清理) ────
  // 步骤:
  //   1. RBAC 检查
  //   2. Pool 里有 socket 则先踢出 (end)
  //   3. 删 wa_account 行 (CASCADE 触发 sim_info / account_health / wa_contact / chat_message 级联删)
  //   4. rm -rf data/slots/<slotIndex>/ (Baileys creds + keys + 未来 media 缓存)
  //   5. slot 回 empty, 保留 proxy_id (代理绑定不随账号清空)
  async clear(id: number, requesterTenantId: number | null): Promise<SlotResponseDto> {
    const slot = await this.slotRepo.findOne({
      where: { id },
      relations: ['account'],
    });
    if (!slot) throw new NotFoundException(`槽位 ${id} 不存在`);
    this.assertCanAccess(slot, requesterTenantId);

    // 1. 踢出 pool socket (如果在线)
    await this.baileys.evictFromPool(id);

    // 2. 删 wa_account (CASCADE 带走 sim_info / account_health / wa_contact / chat_message)
    const accountIdToDelete = slot.accountId;
    slot.accountId = null;
    slot.account = null;
    slot.status = AccountSlotStatus.Empty;
    slot.persona = null;
    slot.profilePath = null;
    await this.slotRepo.save(slot);
    if (accountIdToDelete) {
      await this.accountRepo.delete(accountIdToDelete);
    }

    // 3. rm -rf data/slots/<slotIndex>/
    const slotDir = getSlotDir(slot.slotIndex);
    try {
      if (fs.existsSync(slotDir)) {
        fs.rmSync(slotDir, { recursive: true, force: true });
      }
    } catch (err) {
      this.logger.warn(`slot ${id} 文件系统清理失败 (${slotDir}): ${err}`);
      // 不阻塞: DB 已清干净, 磁盘残留留给用户手工处理
    }

    this.logger.log(`Cleared slot ${id} (tenant ${slot.tenantId}, index ${slot.slotIndex})`);
    return this.toResponse(slot);
  }

  // ── 绑代理 (M2 W3.5: 槽位级出口隔离) ──────────────────────────
  // proxyId=null 取消绑定 (dev 直连); 否则必须是本租户拥有的 proxy
  async assignProxy(id: number, requesterTenantId: number | null, proxyId: number | null): Promise<SlotResponseDto> {
    const slot = await this.slotRepo.findOne({ where: { id }, relations: ['account'] });
    if (!slot) throw new NotFoundException(`槽位 ${id} 不存在`);
    this.assertCanAccess(slot, requesterTenantId);

    if (proxyId !== null) {
      const proxy = await this.proxyRepo.findOne({ where: { id: proxyId } });
      if (!proxy) throw new NotFoundException(`代理 ${proxyId} 不存在`);
      if (requesterTenantId !== null && proxy.tenantId !== requesterTenantId) {
        throw new ForbiddenException('无权限使用该代理');
      }
      // 代理切换会断开现有 socket, 下次 bind/rehydrate 走新代理
      await this.baileys.evictFromPool(slot.id);

      const desc: ProxyDescriptor = {
        type: proxy.proxyType as ProxyDescriptor['type'],
        host: proxy.host,
        port: proxy.port,
        username: proxy.username,
        password: proxy.password,
      };
      writeProxyConf(slot.slotIndex, desc);
    } else {
      writeProxyConf(slot.slotIndex, null);
      await this.baileys.evictFromPool(slot.id);
    }

    slot.proxyId = proxyId;
    await this.slotRepo.save(slot);
    this.logger.log(`slot ${id} proxy_id → ${proxyId}`);
    return this.toResponse(slot);
  }

  // ── 权限检查 ───────────────────────────────────────────────
  // 平台超管 (tenantId=null) 可访问任何; 租户用户只能访问自己租户
  private assertCanAccess(slot: AccountSlotEntity, requesterTenantId: number | null): void {
    if (requesterTenantId === null) return;
    if (slot.tenantId === requesterTenantId) return;
    throw new ForbiddenException('无权限访问该槽位');
  }

  private toResponse(slot: AccountSlotEntity, stats?: AccountSideStats): SlotResponseDto {
    const WARMUP_TOTAL_DAYS = 7; // 2026-04-22 · 从 14 改 7 (用户要求压缩方案)
    const currentDay = stats?.warmupCurrentDay ?? 0;
    const progressPct = Math.round((currentDay / WARMUP_TOTAL_DAYS) * 100);
    // 2026-04-22 · 实际 socket 是否在 pool · 用平滑版本 (60s 内开过就算 online)
    const online = this.baileys.isOnlineSmooth(slot.id);
    return {
      id: slot.id,
      tenantId: slot.tenantId,
      slotIndex: slot.slotIndex,
      status: slot.status,
      // 2026-04-25 · D11-1 · 角色字段返给前端 · 卡片画 role badge 用
      role: slot.role ?? AccountSlotRole.Broadcast,
      online,
      accountId: slot.accountId,
      phoneNumber: slot.account?.phoneNumber ?? null,
      waNickname: slot.account?.waNickname ?? null,
      warmupStage: slot.account?.warmupStage ?? null,
      proxyId: slot.proxyId,
      profilePath: slot.profilePath,
      createdAt: slot.createdAt,
      // 2026-04-25 · 稳定性 · 真实状态三指标
      suspendedUntil: slot.suspendedUntil ? slot.suspendedUntil.toISOString() : null,
      socketLastHeartbeatAt: slot.socketLastHeartbeatAt
        ? slot.socketLastHeartbeatAt.toISOString()
        : null,
      // 2026-04-21 · 卡片信息增强
      warmupStartedAt: stats?.warmupStartedAt ?? null,
      warmupTotalDays: WARMUP_TOTAL_DAYS,
      warmupCurrentDay: currentDay,
      warmupProgressPct: Math.min(progressPct, 100),
      warmupPhase: stats?.warmupPhase ?? null,
      tasksExecuted: stats?.tasksExecuted ?? 0,
      contactsCount: stats?.contactsCount ?? 0,
      channelsCount: stats?.channelsCount ?? 0,
      groupsCount: stats?.groupsCount ?? 0,
      simInfo: stats?.simInfo ?? null,
    };
  }
}

// 2026-04-22 · 从 DB 行 + telco-registry 合成前端用视图
function buildSimInfoView(sim: {
  carrier: string | null;
  country_code: string | null;
  carrier_id: string | null;
  custom_carrier_name: string | null;
  custom_country_name: string | null;
  iccid_suffix: string | null;
  notes: string | null;
}): SlotSimInfoView {
  let displayCarrier: string | null = null;
  let displayCountry: string | null = null;

  if (sim.carrier_id) {
    const hit = getTelcoById(sim.carrier_id);
    if (hit) {
      displayCarrier = hit.telco.brand
        ? `${hit.telco.name} (${hit.telco.brand})`
        : hit.telco.name;
    }
  }
  if (!displayCarrier && sim.custom_carrier_name) {
    displayCarrier = sim.custom_carrier_name;
  }
  if (!displayCarrier && sim.carrier) {
    // 向后兼容旧 free-text 字段
    displayCarrier = sim.carrier;
  }

  if (sim.country_code) {
    const c = getCountry(sim.country_code);
    if (c) displayCountry = `${c.flag} ${c.name}`;
  }
  if (!displayCountry && sim.custom_country_name) {
    displayCountry = sim.custom_country_name;
  }

  return {
    countryCode: sim.country_code,
    carrierId: sim.carrier_id,
    customCarrierName: sim.custom_carrier_name,
    customCountryName: sim.custom_country_name,
    iccidSuffix: sim.iccid_suffix,
    notes: sim.notes,
    displayCarrier,
    displayCountry,
    // 旧字段向后兼容
    iccid: sim.iccid_suffix,
    carrier: displayCarrier,
    country: sim.country_code,
  };
}
