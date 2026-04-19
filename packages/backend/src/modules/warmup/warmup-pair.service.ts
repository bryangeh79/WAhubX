import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AccountSlotEntity, AccountSlotStatus } from '../slots/account-slot.entity';
import { WaAccountEntity } from '../slots/wa-account.entity';

// script_chat 的 A-B 配对选择
// 过滤链 (用户 2026-04-20 决策, 对齐 §B.15 "同 IP 的号绝不互加"):
//   候选池 = 同租户其他槽位
//     .filter(warmup_stage >= script.min_warmup_stage)   -- 剧本门槛
//     .filter(!takeover_active)                           -- M3 rejection #4
//     .filter(status != 'suspended')                      -- 停用号不接活
//     .filter(status != 'empty')                          -- 无账号绑定的空槽
//     .filter(proxy_id != initiator.proxy_id)             -- IP 组互斥 §B.15 #1
//   → 随机抽 1
//   → 空集 skip, 不强配 (raise NoPairAvailable)
@Injectable()
export class WarmupPairService {
  private readonly logger = new Logger(WarmupPairService.name);

  constructor(
    @InjectRepository(AccountSlotEntity) private readonly slotRepo: Repository<AccountSlotEntity>,
    @InjectRepository(WaAccountEntity) private readonly accountRepo: Repository<WaAccountEntity>,
  ) {}

  async pickPartner(initiatorAccountId: number, requiredWarmupStage: number): Promise<number | null> {
    const initiatorSlot = await this.slotRepo.findOne({ where: { accountId: initiatorAccountId } });
    if (!initiatorSlot) {
      this.logger.warn(`initiator account ${initiatorAccountId} 无 slot, skip pair`);
      return null;
    }

    const candidates = await this.slotRepo.find({
      where: {
        tenantId: initiatorSlot.tenantId,
        takeoverActive: false,
        status: In([AccountSlotStatus.Active, AccountSlotStatus.Warmup]),
      },
    });

    // 手动在内存里过滤剩下条件 (避免 TypeORM 复合 where + array 复杂度)
    const eligible: AccountSlotEntity[] = [];
    const accountIds = candidates
      .filter((s) => s.accountId !== null && s.accountId !== initiatorAccountId)
      .map((s) => s.accountId as number);
    if (accountIds.length === 0) return null;
    const accounts = await this.accountRepo.find({ where: { id: In(accountIds) } });
    const accountById = new Map(accounts.map((a) => [a.id, a]));

    for (const slot of candidates) {
      if (slot.accountId === null || slot.accountId === initiatorAccountId) continue;
      // IP 组互斥: 自身 proxy_id 和候选必须不同. null 也算独立组 (dev direct 场景保守视为同组).
      if (initiatorSlot.proxyId !== null && slot.proxyId === initiatorSlot.proxyId) continue;
      if (initiatorSlot.proxyId === null && slot.proxyId === null) continue;
      const acc = accountById.get(slot.accountId);
      if (!acc) continue;
      if (acc.warmupStage < requiredWarmupStage) continue;
      eligible.push(slot);
    }

    if (eligible.length === 0) {
      this.logger.debug(
        `no pair for account ${initiatorAccountId} · stage≥${requiredWarmupStage} · tenant=${initiatorSlot.tenantId}`,
      );
      return null;
    }

    const picked = eligible[Math.floor(Math.random() * eligible.length)];
    return picked.accountId as number;
  }
}
