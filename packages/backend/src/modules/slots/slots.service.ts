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
import type { SlotResponseDto } from './dto/slot-response.dto';
import { BaileysService } from '../baileys/baileys.service';
import { getSlotDir } from '../../common/storage';

@Injectable()
export class SlotsService {
  private readonly logger = new Logger(SlotsService.name);

  constructor(
    @InjectRepository(AccountSlotEntity)
    private readonly slotRepo: Repository<AccountSlotEntity>,
    @InjectRepository(WaAccountEntity)
    private readonly accountRepo: Repository<WaAccountEntity>,
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
    this.logger.log(`Seeded ${slotLimit} empty slots for tenant ${tenantId}`);
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
