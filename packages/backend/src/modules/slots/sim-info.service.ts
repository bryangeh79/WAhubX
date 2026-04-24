// 2026-04-22 · SIM 信息录入 · 3-Tier (预置库/部分命中/全自由)
// Tier 1: countryCode + carrierId 都预置库命中 (最常见)
// Tier 2: countryCode 命中 · carrierId 空 · 租户手填 customCarrierName
// Tier 3: 国家都未预置 · 租户手填 customCountryName + customCarrierName
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AccountSlotEntity } from './account-slot.entity';
import { SimInfoEntity } from './sim-info.entity';
import { COUNTRY_REGISTRY, getCountry, getTelcoById } from '../../data/telco-registry';

export interface UpdateSimInfoDto {
  countryCode?: string | null;         // 'MY' · 预置国家
  carrierId?: string | null;           // 'maxis' · 预置 telco
  customCarrierName?: string | null;   // 手填 telco (非预置)
  customCountryName?: string | null;   // 手填国家 (未预置)
  iccidSuffix?: string | null;         // ICCID 尾号
  notes?: string | null;
}

export interface BulkUpdateItemDto extends UpdateSimInfoDto {
  slotId: number;
}

@Injectable()
export class SimInfoService {
  private readonly logger = new Logger(SimInfoService.name);

  constructor(
    @InjectRepository(AccountSlotEntity)
    private readonly slotRepo: Repository<AccountSlotEntity>,
    @InjectRepository(SimInfoEntity)
    private readonly simRepo: Repository<SimInfoEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /** 返回预置的 telco 库 · 前端初始化下拉用 */
  getTelcoRegistry() {
    return COUNTRY_REGISTRY;
  }

  /** 单槽位更新 */
  async updateForSlot(
    slotId: number,
    requesterTenantId: number | null,
    dto: UpdateSimInfoDto,
  ): Promise<SimInfoEntity> {
    const slot = await this.slotRepo.findOne({ where: { id: slotId } });
    if (!slot) throw new NotFoundException(`槽位 ${slotId} 不存在`);
    if (requesterTenantId !== null && slot.tenantId !== requesterTenantId) {
      throw new ForbiddenException('无权限访问该槽位');
    }
    if (!slot.accountId) {
      throw new NotFoundException(`槽位 ${slotId} 未绑账号 · 无法设置 SIM 信息`);
    }

    const normalized = this.normalize(dto);
    await this.maybeRecordUnknownCountry(requesterTenantId, normalized);

    let sim = await this.simRepo.findOne({ where: { accountId: slot.accountId } });
    if (!sim) {
      sim = this.simRepo.create({ accountId: slot.accountId });
    }
    sim.countryCode = normalized.countryCode ?? null;
    sim.carrierId = normalized.carrierId ?? null;
    sim.customCarrierName = normalized.customCarrierName ?? null;
    sim.customCountryName = normalized.customCountryName ?? null;
    sim.iccidSuffix = normalized.iccidSuffix ?? null;
    sim.notes = normalized.notes ?? null;
    // 旧 free-text 字段 · 同步一份合成值 (向后兼容旧查询)
    if (normalized.carrierId) {
      const hit = getTelcoById(normalized.carrierId);
      sim.carrier = hit?.telco.name ?? null;
    } else {
      sim.carrier = normalized.customCarrierName ?? null;
    }
    await this.simRepo.save(sim);
    this.logger.log(
      `SIM 信息更新 · slot=${slotId} acc=${slot.accountId} country=${sim.countryCode ?? 'custom'} telco=${sim.carrierId ?? sim.customCarrierName ?? '-'}`,
    );
    return sim;
  }

  /** 批量 · 同一份参数套用到多个槽位 */
  async bulkUpdate(
    items: BulkUpdateItemDto[],
    requesterTenantId: number | null,
  ): Promise<{ updated: number; errors: Array<{ slotId: number; message: string }> }> {
    let updated = 0;
    const errors: Array<{ slotId: number; message: string }> = [];
    for (const item of items) {
      try {
        const { slotId, ...payload } = item;
        await this.updateForSlot(slotId, requesterTenantId, payload);
        updated++;
      } catch (err) {
        errors.push({
          slotId: item.slotId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { updated, errors };
  }

  /** 规整 + 校验 */
  private normalize(dto: UpdateSimInfoDto): UpdateSimInfoDto {
    const countryCode = dto.countryCode?.toUpperCase().trim() || null;
    const carrierId = dto.carrierId?.trim() || null;
    const customCarrierName = dto.customCarrierName?.trim() || null;
    const customCountryName = dto.customCountryName?.trim() || null;
    const iccidSuffix = dto.iccidSuffix?.replace(/\D+/g, '').slice(-10) || null;
    const notes = dto.notes?.trim() || null;

    // 如果 countryCode 不在预置库 · 抹掉 countryCode · 走 custom country
    let finalCountryCode: string | null = countryCode;
    if (countryCode && !getCountry(countryCode)) {
      finalCountryCode = null;
    }
    // 如果 carrierId 不在预置库 · 抹掉
    let finalCarrierId: string | null = carrierId;
    if (carrierId && !getTelcoById(carrierId)) {
      finalCarrierId = null;
    }

    return {
      countryCode: finalCountryCode,
      carrierId: finalCarrierId,
      customCarrierName,
      customCountryName,
      iccidSuffix,
      notes,
    };
  }

  /** 冷门国家计数累加 · 供后台决定下版本是否入预置库 */
  private async maybeRecordUnknownCountry(
    tenantId: number | null,
    dto: UpdateSimInfoDto,
  ): Promise<void> {
    if (dto.countryCode || !dto.customCountryName) return;
    const countryName = dto.customCountryName.trim();
    const carrierName = dto.customCarrierName?.trim() ?? null;
    // 无 calling code 信息时用 '?' · 前端可能不传
    const callingCode = '?';
    try {
      await this.dataSource.query(
        `INSERT INTO unknown_country_request (calling_code, country_name, carrier_name, tenant_id, count, first_seen, last_seen)
         VALUES ($1, $2, $3, $4, 1, NOW(), NOW())
         ON CONFLICT (calling_code, country_name)
         DO UPDATE SET count = unknown_country_request.count + 1, last_seen = NOW(),
                       carrier_name = COALESCE(EXCLUDED.carrier_name, unknown_country_request.carrier_name)`,
        [callingCode, countryName, carrierName, tenantId],
      );
    } catch (err) {
      this.logger.warn(`unknown_country_request 记录失败: ${err}`);
    }
  }
}
