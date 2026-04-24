import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// 2026-04-23 · 选"成熟营运号" · plan §C eligibleSlots
// 定义: warmup_plan.current_phase = 3 (Mature) AND warmup_plan.paused = false
//       AND account_slot.status NOT IN ('suspended', 'empty')
//       AND account_slot.takeover_active = false
//       AND tenant_id 匹配

export interface MatureSlot {
  slotId: number;
  slotIndex: number;
  accountId: number;
  proxyId: number | null;
}

// 2026-04-24 · 自定义槽位允许租户挑未成熟号 (有风险但可选)
export interface ActiveSlot extends MatureSlot {
  isMature: boolean;          // current_phase >= 3
  currentPhase: number | null; // 0=孵化 · 1=预热 · 2=激活 · 3=成熟
  currentDay: number | null;   // 第几天 (0-14)
  phoneNumber: string | null;
}

@Injectable()
export class MatureSlotPickerService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * 查询租户下所有成熟号 (用于承载计算 + 调度分配)
   * 注意: suspended 状态的号**不计入** — HANDOVER 提 "WA 看到同 IP 多号 linked 会关联风控"
   */
  async findMatureSlots(tenantId: number): Promise<MatureSlot[]> {
    const rows = await this.dataSource.query<
      Array<{ slot_id: number; slot_index: number; account_id: number; proxy_id: number | null }>
    >(
      `
      SELECT s.id as slot_id, s.slot_index, s.account_id, s.proxy_id
      FROM account_slot s
      INNER JOIN warmup_plan p ON p.account_id = s.account_id
      WHERE s.tenant_id = $1
        AND s.status IN ('active', 'warmup')
        AND s.takeover_active = false
        AND s.account_id IS NOT NULL
        AND p.current_phase >= 3
        AND p.paused = false
      ORDER BY s.slot_index ASC
      `,
      [tenantId],
    );
    return rows.map((r) => ({
      slotId: Number(r.slot_id),
      slotIndex: Number(r.slot_index),
      accountId: Number(r.account_id),
      proxyId: r.proxy_id === null ? null : Number(r.proxy_id),
    }));
  }

  /**
   * 筛选 · custom_slot_ids ∩ matureSlots
   */
  async findMatureSlotsIn(tenantId: number, slotIds: number[]): Promise<MatureSlot[]> {
    if (slotIds.length === 0) return [];
    const all = await this.findMatureSlots(tenantId);
    const set = new Set(slotIds);
    return all.filter((s) => set.has(s.slotId));
  }

  /**
   * 2026-04-24 · 查所有"可选"槽位 · 不仅成熟号
   * 排除: empty / suspended / takeover 中
   * 包含: active / warmup · 带 isMature 标记
   * 用途: 自定义槽位模式的 UI picker (允许租户强制选未成熟号)
   */
  async findAllActiveSlots(tenantId: number): Promise<ActiveSlot[]> {
    const rows = await this.dataSource.query<
      Array<{
        slot_id: number;
        slot_index: number;
        account_id: number;
        proxy_id: number | null;
        phone_number: string | null;
        current_phase: number | null;
        current_day: number | null;
        paused: boolean | null;
      }>
    >(
      `
      SELECT
        s.id AS slot_id,
        s.slot_index,
        s.account_id,
        s.proxy_id,
        a.phone_number,
        p.current_phase,
        p.current_day,
        p.paused
      FROM account_slot s
      LEFT JOIN warmup_plan p ON p.account_id = s.account_id
      LEFT JOIN wa_account a ON a.id = s.account_id
      WHERE s.tenant_id = $1
        AND s.status IN ('active', 'warmup')
        AND s.takeover_active = false
        AND s.account_id IS NOT NULL
      ORDER BY s.slot_index ASC
      `,
      [tenantId],
    );
    return rows.map((r) => {
      const phase = r.current_phase === null ? null : Number(r.current_phase);
      const isMature = phase !== null && phase >= 3 && r.paused !== true;
      return {
        slotId: Number(r.slot_id),
        slotIndex: Number(r.slot_index),
        accountId: Number(r.account_id),
        proxyId: r.proxy_id === null ? null : Number(r.proxy_id),
        phoneNumber: r.phone_number,
        currentPhase: phase,
        currentDay: r.current_day === null ? null : Number(r.current_day),
        isMature,
      };
    });
  }

  /**
   * 2026-04-24 · 自定义模式: 按 slotIds 取 active slot (含未成熟号)
   */
  async findSlotsIn(tenantId: number, slotIds: number[]): Promise<ActiveSlot[]> {
    if (slotIds.length === 0) return [];
    const all = await this.findAllActiveSlots(tenantId);
    const set = new Set(slotIds);
    return all.filter((s) => set.has(s.slotId));
  }

  /**
   * 查询某 slot 今日已发广告数 (status=Sent, sent_at 今天)
   * 用于 daily cap 检测
   */
  async countTodaySent(slotId: number, now: Date = new Date()): Promise<number> {
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const rows = await this.dataSource.query<Array<{ cnt: string }>>(
      `
      SELECT COUNT(*)::text as cnt
      FROM campaign_target
      WHERE assigned_slot_id = $1
        AND status = 2
        AND sent_at >= $2
        AND sent_at < $3
      `,
      [slotId, startOfDay, endOfDay],
    );
    return rows.length > 0 ? Number(rows[0].cnt) : 0;
  }
}
