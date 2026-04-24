import { AccountSlotStatus } from '../account-slot.entity';

export class SlotResponseDto {
  id!: number;
  tenantId!: number;
  slotIndex!: number;
  status!: AccountSlotStatus;
  online!: boolean; // 2026-04-22 · 实际 pool 是否有 socket (与 status 独立 · status=active 也可能 online=false)
  // 2026-04-25 · 稳定性: 真实状态三指标
  suspendedUntil!: string | null;         // suspended 冷却到何时 · 期间不动
  socketLastHeartbeatAt!: string | null;  // 最后心跳时间 · UI 判 healthy/degraded/dead
  accountId!: number | null;
  phoneNumber!: string | null;
  waNickname!: string | null;
  warmupStage!: number | null;
  proxyId!: number | null;
  profilePath!: string | null;
  createdAt!: Date;

  // 2026-04-21 · 卡片信息增强
  // Warmup 进度
  warmupStartedAt!: string | null;  // 养号开始时间 ISO
  warmupTotalDays!: number;          // 14
  warmupCurrentDay!: number;         // 1..14
  warmupProgressPct!: number;        // 0-100
  warmupPhase!: number | null;       // 0..3
  // 统计
  tasksExecuted!: number;            // 该 slot 的 task_run 条数
  contactsCount!: number;            // 已绑账号的 wa_contact (非群)
  channelsCount!: number;            // 已 follow 的频道数 (wa_contact 标注的)
  groupsCount!: number;              // 已加入的群数
  // SIM 卡信息 (2026-04-22 扩 · 前端显示 + 编辑)
  simInfo!: {
    // 预置库命中 (Tier 1/2)
    countryCode?: string | null;      // 'MY' · ISO alpha-2
    carrierId?: string | null;         // 'maxis' · telco-registry key
    // 自由填 (Tier 2/3 兜底)
    customCarrierName?: string | null; // 'XOX Mobile' · 租户填的非预置 telco
    customCountryName?: string | null; // 'Nepal' · 未预置国家
    // 附加
    iccidSuffix?: string | null;       // ICCID 尾 6-10 位
    notes?: string | null;             // 备注
    // 合成显示用 (后端算好, 前端直接显)
    displayCarrier?: string | null;    // "Maxis" / "XOX Mobile" / "未知运营商"
    displayCountry?: string | null;    // "🇲🇾 Malaysia" / "Nepal"
    // 旧字段 (向后兼容 · 弃用中)
    iccid?: string | null;
    carrier?: string | null;
    country?: string | null;
  } | null;
}
