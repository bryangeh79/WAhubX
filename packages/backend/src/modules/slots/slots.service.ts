import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AccountSlotEntity, AccountSlotStatus } from './account-slot.entity';
import type { SlotResponseDto } from './dto/slot-response.dto';

@Injectable()
export class SlotsService {
  private readonly logger = new Logger(SlotsService.name);

  constructor(
    @InjectRepository(AccountSlotEntity)
    private readonly slotRepo: Repository<AccountSlotEntity>,
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

  // ── clear: 置空槽位 (删 wa_account 关联 + 回到 empty 状态) ────
  // M2 Baileys 接入前只做 DB 层清理, M2 后加文件系统清理 (profile_path 目录)
  async clear(id: number, requesterTenantId: number | null): Promise<SlotResponseDto> {
    const slot = await this.slotRepo.findOne({
      where: { id },
      relations: ['account'],
    });
    if (!slot) throw new NotFoundException(`槽位 ${id} 不存在`);
    this.assertCanAccess(slot, requesterTenantId);

    slot.accountId = null;
    slot.account = null;
    slot.status = AccountSlotStatus.Empty;
    slot.persona = null;
    slot.profilePath = null;
    // proxyId 保留 (代理绑定不随账号清除)
    await this.slotRepo.save(slot);
    // TODO(M2): 删 data/slots/<slotIndex>/ 目录, 删 wa_account 行 + 级联 sim_info/account_health
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
