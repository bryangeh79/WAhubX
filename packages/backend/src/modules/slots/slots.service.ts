import {
  ForbiddenException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import * as fs from 'node:fs';
import { AccountSlotEntity, AccountSlotStatus } from './account-slot.entity';
import { WaAccountEntity } from './wa-account.entity';
import { TenantEntity } from '../tenants/tenant.entity';
import { ProxyEntity } from '../proxies/proxy.entity';
import type { SlotResponseDto } from './dto/slot-response.dto';
import { BaileysService } from '../baileys/baileys.service';
import { getSlotDir } from '../../common/storage';
import { ensureFingerprint } from '../../common/fingerprint';
import { writeProxyConf, type ProxyDescriptor } from '../../common/proxy-config';

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
  ) {}

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

    const rows = Array.from({ length: slotLimit }, (_, i) =>
      manager.create(AccountSlotEntity, {
        tenantId,
        slotIndex: i + 1,
        accountId: null,
        status: AccountSlotStatus.Empty,
        proxyId: null,
        persona: null,
        profilePath: null,
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
    return slots.map((s) => this.toResponse(s));
  }

  async findOne(id: number, requesterTenantId: number | null): Promise<SlotResponseDto> {
    const slot = await this.slotRepo.findOne({
      where: { id },
      relations: ['account'],
    });
    if (!slot) throw new NotFoundException(`槽位 ${id} 不存在`);
    this.assertCanAccess(slot, requesterTenantId);
    return this.toResponse(slot);
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

  private toResponse(slot: AccountSlotEntity): SlotResponseDto {
    return {
      id: slot.id,
      tenantId: slot.tenantId,
      slotIndex: slot.slotIndex,
      status: slot.status,
      accountId: slot.accountId,
      phoneNumber: slot.account?.phoneNumber ?? null,
      waNickname: slot.account?.waNickname ?? null,
      warmupStage: slot.account?.warmupStage ?? null,
      proxyId: slot.proxyId,
      profilePath: slot.profilePath,
      createdAt: slot.createdAt,
    };
  }
}
