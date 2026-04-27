// 2026-04-23 · 广告投放模块 API client · plan rosy-dazzling-wave
import { api } from './api';

// ──────────────────────────────────────────────────────────────
// 类型 (与 backend entity 对齐 · 只定前端需要的字段)
// ──────────────────────────────────────────────────────────────

export type ScheduleMode = 'immediate' | 'once' | 'daily' | 'weekly';

export interface CampaignSchedule {
  mode: ScheduleMode;
  fireAt?: string;
  time?: string;
  startDate?: string;
  endDate?: string | null;
  days?: number[]; // 0=Sun ... 6=Sat
}

export interface CampaignTargets {
  groupIds: number[];
  extraPhones: string[];
}

export enum AdStrategy {
  Single = 1,
  Rotation = 2,
}

export enum OpeningStrategy {
  Fixed = 1,
  Random = 2,
  None = 3,
}

export enum ExecutionMode {
  Smart = 1,
  CustomSlots = 2,
}

export enum ThrottleProfile {
  Conservative = 1,
  Balanced = 2,
  Aggressive = 3,
}

export enum SafetyStatus {
  Green = 1,
  Yellow = 2,
  Red = 3,
}

export enum CampaignStatus {
  Draft = 0,
  Running = 1,
  Paused = 2,
  Done = 3,
  Cancelled = 4,
}

export interface AdVariant {
  index: number;
  content: string;
  enabled: boolean;
}

export interface Advertisement {
  id: number;
  name: string;
  content: string;
  assetId: number | null;
  aiEnabled: boolean;
  variants: AdVariant[];
  status: number;
  createdAt: string;
  updatedAt: string;
}

export interface OpeningVariant {
  index: number;
  content: string;
  enabled: boolean;
}

export interface OpeningLine {
  id: number;
  name: string;
  content: string;
  aiEnabled: boolean;
  variants: OpeningVariant[];
  status: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerGroup {
  id: number;
  name: string;
  description: string | null;
  memberCount: number;
  badCount?: number; // 坏号总数 (BadInvalid + BadNetwork + OptedOut)
  okCount?: number; // 可用号数
  createdAt: string;
  updatedAt: string;
}

export interface CustomerGroupMember {
  id: number;
  groupId: number;
  contactId: number | null;
  phoneE164: string;
  isFriend: boolean | null;
  source: number;
  note: string | null;
  sendStatus: number; // 0 ok · 1 bad_invalid · 2 bad_network · 3 opted_out
  sendCount: number;
  failCount: number;
  lastAttemptAt: string | null;
  lastErrorCode: string | null;
  lastErrorMsg: string | null;
  createdAt: string;
}

export enum MemberSendStatus {
  Ok = 0,
  BadInvalid = 1,
  BadNetwork = 2,
  OptedOut = 3,
}

export interface ImportResult {
  added: number;
  skippedDuplicate: number;
  skippedInvalid: number;
  total: number;
}

export interface MatureSlot {
  slotId: number;
  slotIndex: number;
  accountId: number;
  proxyId: number | null;
}

// 2026-04-24 · 自定义槽位 picker · 含未成熟号 · 带 isMature 标记
export interface ActiveSlot extends MatureSlot {
  isMature: boolean;
  currentPhase: number | null;
  currentDay: number | null;
  phoneNumber: string | null;
}

export interface SafetyPreview {
  matureSlots: number;
  eligibleSlots: number;
  immatureSlots?: number;
  dailyCap: number;
  totalTargets: number;
  days: number;
  capacity: number;
  rate: number;
  status: SafetyStatus;
  message: string;
}

export interface Campaign {
  id: number;
  tenantId: number;
  name: string;
  schedule: CampaignSchedule;
  targets: CampaignTargets;
  adStrategy: AdStrategy;
  adIds: number[];
  openingStrategy: OpeningStrategy;
  openingIds: number[];
  executionMode: ExecutionMode;
  customSlotIds: number[];
  throttleProfile: ThrottleProfile;
  safetyStatus: SafetyStatus;
  safetySnapshot: SafetyPreview | null;
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignRun {
  id: number;
  campaignId: number;
  fireAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: number;
  stats: { planned?: number; sent?: number; failed?: number; skipped?: number };
}

export interface CampaignTarget {
  id: string;
  runId: number;
  campaignId: number;
  phoneE164: string;
  contactId: number | null;
  assignedSlotId: number | null;
  adId: number | null;
  openingId: number | null;
  taskId: number | null;
  status: number;
  errorCode: string | null;
  errorMsg: string | null;
  sentAt: string | null;
  repliedAt: string | null;
  replyCount: number;
  scheduledAt: string | null;  // 2026-04-27 · 任务计划执行时间 · 给 UI 显示 "等到 X 时" 用
  taskStatus: string | null;
}

export interface CreateCampaignPayload {
  name: string;
  schedule: CampaignSchedule;
  targets: CampaignTargets;
  adStrategy: AdStrategy;
  adIds: number[];
  openingStrategy: OpeningStrategy;
  openingIds?: number[];
  executionMode: ExecutionMode;
  customSlotIds?: number[];
  throttleProfile?: ThrottleProfile;
  startNow?: boolean;
}

// ──────────────────────────────────────────────────────────────
// Feature flag
// ──────────────────────────────────────────────────────────────

export const campaignStateApi = {
  async moduleEnabled(): Promise<boolean> {
    try {
      const res = await api.get<{ enabled: boolean }>('/campaign-state/module-enabled');
      return res.data.enabled === true;
    } catch {
      return false;
    }
  },
};

// ──────────────────────────────────────────────────────────────
// Advertisements
// ──────────────────────────────────────────────────────────────

export const adsApi = {
  async list(): Promise<Advertisement[]> {
    const res = await api.get<Advertisement[]>('/advertisements');
    return res.data;
  },
  async get(id: number): Promise<Advertisement> {
    const res = await api.get<Advertisement>(`/advertisements/${id}`);
    return res.data;
  },
  async create(body: {
    name: string;
    content: string;
    assetId?: number | null;
    aiEnabled?: boolean;
  }): Promise<Advertisement> {
    const res = await api.post<Advertisement>('/advertisements', body);
    return res.data;
  },
  async update(
    id: number,
    body: Partial<{
      name: string;
      content: string;
      assetId: number | null;
      aiEnabled: boolean;
      variants: AdVariant[];
      status: number;
    }>,
  ): Promise<Advertisement> {
    const res = await api.patch<Advertisement>(`/advertisements/${id}`, body);
    return res.data;
  },
  async remove(id: number): Promise<void> {
    await api.delete(`/advertisements/${id}`);
  },
  async generateVariants(id: number, count = 10, append = false): Promise<Advertisement> {
    const res = await api.post<Advertisement>(
      `/advertisements/${id}/generate-variants`,
      { count, append },
      { timeout: 60_000 }, // AI 生成可能慢
    );
    return res.data;
  },
};

// ──────────────────────────────────────────────────────────────
// Opening lines
// ──────────────────────────────────────────────────────────────

export const openingLinesApi = {
  async list(): Promise<OpeningLine[]> {
    const res = await api.get<OpeningLine[]>('/opening-lines');
    return res.data;
  },
  async create(body: { name: string; content: string; aiEnabled?: boolean }): Promise<OpeningLine> {
    const res = await api.post<OpeningLine>('/opening-lines', body);
    return res.data;
  },
  async update(
    id: number,
    body: Partial<{
      name: string;
      content: string;
      aiEnabled: boolean;
      variants: OpeningVariant[];
      status: number;
    }>,
  ): Promise<OpeningLine> {
    const res = await api.patch<OpeningLine>(`/opening-lines/${id}`, body);
    return res.data;
  },
  async remove(id: number): Promise<void> {
    await api.delete(`/opening-lines/${id}`);
  },
  async generateVariants(id: number, count = 10, append = false): Promise<OpeningLine> {
    const res = await api.post<OpeningLine>(
      `/opening-lines/${id}/generate-variants`,
      { count, append },
      { timeout: 60_000 },
    );
    return res.data;
  },
};

// ──────────────────────────────────────────────────────────────
// Customer groups
// ──────────────────────────────────────────────────────────────

export const customerGroupsApi = {
  async list(): Promise<CustomerGroup[]> {
    const res = await api.get<CustomerGroup[]>('/customer-groups');
    return res.data;
  },
  async get(id: number): Promise<CustomerGroup> {
    const res = await api.get<CustomerGroup>(`/customer-groups/${id}`);
    return res.data;
  },
  async create(body: { name: string; description?: string }): Promise<CustomerGroup> {
    const res = await api.post<CustomerGroup>('/customer-groups', body);
    return res.data;
  },
  async update(id: number, body: Partial<{ name: string; description: string }>): Promise<CustomerGroup> {
    const res = await api.patch<CustomerGroup>(`/customer-groups/${id}`, body);
    return res.data;
  },
  async remove(id: number): Promise<void> {
    await api.delete(`/customer-groups/${id}`);
  },
  async listMembers(id: number, page = 1, pageSize = 50) {
    const res = await api.get<{ items: CustomerGroupMember[]; total: number; page: number; pageSize: number }>(
      `/customer-groups/${id}/members`,
      { params: { page, pageSize } },
    );
    return res.data;
  },
  async importPaste(id: number, raw: string): Promise<ImportResult> {
    const res = await api.post<ImportResult>(`/customer-groups/${id}/members/import-paste`, { raw });
    return res.data;
  },
  async importCsv(id: number, raw: string): Promise<ImportResult> {
    const res = await api.post<ImportResult>(`/customer-groups/${id}/members/import-csv`, { raw });
    return res.data;
  },
  async pickContacts(id: number, contactIds: number[]): Promise<ImportResult> {
    const res = await api.post<ImportResult>(`/customer-groups/${id}/members/pick-contacts`, { contactIds });
    return res.data;
  },
  async removeMember(id: number, memberId: number): Promise<void> {
    await api.delete(`/customer-groups/${id}/members/${memberId}`);
  },
  async setMemberStatus(id: number, memberId: number, status: MemberSendStatus): Promise<void> {
    await api.patch(`/customer-groups/${id}/members/${memberId}/status`, { status });
  },
  async clearMembers(id: number): Promise<{ removed: number }> {
    const res = await api.delete<{ removed: number }>(`/customer-groups/${id}/members`);
    return res.data;
  },
  async clone(id: number): Promise<CustomerGroup> {
    const res = await api.post<CustomerGroup>(`/customer-groups/${id}/clone`);
    return res.data;
  },
  async listContacts(params: { accountId?: number; keyword?: string; limit?: number } = {}): Promise<ContactOption[]> {
    const res = await api.get<ContactOption[]>(`/customer-groups/contacts/list`, { params });
    return res.data;
  },
};

export interface ContactOption {
  id: number;
  accountId: number;
  phoneE164: string;
  displayName: string | null;
  lastMessageAt: string | null;
}

// ──────────────────────────────────────────────────────────────
// Campaigns
// ──────────────────────────────────────────────────────────────

// 2026-04-24 · 投放结果报告
export interface CampaignReport {
  campaignId: number;
  campaignName: string;
  status: CampaignStatus;
  overall: {
    planned: number;
    sent: number;
    failed: number;
    skipped: number;
    doneCount: number;
    successRate: number;
    replied: number;
    totalReplies: number;
    replyRate: number;
  };
  timing: {
    firstSent: string | null;
    lastSent: string | null;
    durationMs: number;
  };
  slotPerformance: Array<{
    slotId: number;
    slotIndex: number;
    phoneNumber: string | null;
    assigned: number;
    sent: number;
    failed: number;
    successRate: number;
  }>;
  adPerformance: Array<{
    adId: number | null;
    adName: string;
    used: number;
    sent: number;
    failed: number;
    successRate: number;
  }>;
  errorBreakdown: Array<{
    code: string;
    count: number;
    sampleMsg: string | null;
  }>;
  hourlyDistribution: Array<{
    hour: number;
    count: number;
  }>;
}

export const campaignsApi = {
  async list(status?: CampaignStatus): Promise<Campaign[]> {
    const res = await api.get<Campaign[]>('/campaigns', {
      params: status !== undefined ? { status } : undefined,
    });
    return res.data;
  },
  async get(id: number): Promise<Campaign> {
    const res = await api.get<Campaign>(`/campaigns/${id}`);
    return res.data;
  },
  async listRuns(id: number): Promise<CampaignRun[]> {
    const res = await api.get<CampaignRun[]>(`/campaigns/${id}/runs`);
    return res.data;
  },
  async listTargets(id: number, runId?: number): Promise<CampaignTarget[]> {
    const res = await api.get<CampaignTarget[]>(`/campaigns/${id}/targets`, {
      params: runId !== undefined ? { runId } : undefined,
    });
    return res.data;
  },
  async matureSlots(): Promise<MatureSlot[]> {
    const res = await api.get<MatureSlot[]>('/campaigns/mature-slots');
    return res.data;
  },
  async allSlots(): Promise<ActiveSlot[]> {
    const res = await api.get<ActiveSlot[]>('/campaigns/slots');
    return res.data;
  },
  async previewSafety(body: {
    schedule: CampaignSchedule;
    targets: CampaignTargets;
    executionMode: ExecutionMode;
    customSlotIds?: number[];
    throttleProfile?: ThrottleProfile;
  }): Promise<SafetyPreview> {
    const res = await api.post<SafetyPreview>('/campaigns/preview-safety', body);
    return res.data;
  },
  async create(body: CreateCampaignPayload): Promise<Campaign> {
    const res = await api.post<Campaign>('/campaigns', body);
    return res.data;
  },
  async start(id: number): Promise<Campaign> {
    const res = await api.post<Campaign>(`/campaigns/${id}/start`);
    return res.data;
  },
  async pause(id: number): Promise<Campaign> {
    const res = await api.post<Campaign>(`/campaigns/${id}/pause`);
    return res.data;
  },
  async resume(id: number): Promise<Campaign> {
    const res = await api.post<Campaign>(`/campaigns/${id}/resume`);
    return res.data;
  },
  async remove(id: number): Promise<void> {
    await api.delete(`/campaigns/${id}`);
  },
  async report(id: number): Promise<CampaignReport> {
    const res = await api.get<CampaignReport>(`/campaigns/${id}/report`);
    return res.data;
  },
  async clone(id: number): Promise<Campaign> {
    const res = await api.post<Campaign>(`/campaigns/${id}/clone`);
    return res.data;
  },
  // 2026-04-27 · 强推该投放下所有 pending task 立即执行 (跳过节流窗口)
  async runNow(id: number): Promise<{ pushed: number }> {
    const res = await api.post<{ pushed: number }>(`/campaigns/${id}/run-now`);
    return res.data;
  },
  // 2026-04-28 · 强推单个 target 立即执行 (per-task · 跳过节流窗口)
  async runNowTarget(
    campaignId: number,
    targetId: string,
  ): Promise<{ pushed: boolean; reason?: string }> {
    const res = await api.post<{ pushed: boolean; reason?: string }>(
      `/campaigns/${campaignId}/targets/${targetId}/run-now`,
    );
    return res.data;
  },
};
