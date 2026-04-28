// 2026-04-24 · 智能客服 API client
import { api } from './api';

export type FaqStatus = 'draft' | 'enabled' | 'disabled';
export type FaqSource = 'ai_generated' | 'manual_bulk' | 'manual_single';
// 2026-04-24 · off: 关 · faq: 纯 FAQ (不需 AI key) · smart: FAQ + AI 兜底 (需 AI key)
export type ReplyMode = 'off' | 'faq' | 'smart';
export type ConversationStage =
  | 'new'
  | 'interested'
  | 'hot_lead'
  | 'handoff_required'
  | 'human_takeover'
  | 'closed'
  | 'do_not_reply';

export interface KnowledgeBase {
  id: number;
  tenantId: number;
  name: string;
  description: string | null;
  goalPrompt: string | null;
  language: string;
  isDefault: boolean;
  status: number;
  createdAt: string;
  updatedAt: string;
}

export interface KbSource {
  id: number;
  kbId: number;
  fileName: string;
  mime: string | null;
  kind: string;
  byteSize: number;
  processedAt: string | null;
  errorMsg: string | null;
  createdAt: string;
}

export interface KbFaq {
  id: number;
  kbId: number;
  question: string;
  answer: string;
  tags: string[];
  status: FaqStatus;
  source: FaqSource;
  hitCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KbProtectedEntity {
  id: number;
  kbId: number;
  entityType: 'phone' | 'email' | 'url' | 'company' | 'address';
  value: string;
  sourceId: number | null;
  createdAt: string;
}

export interface KbStats {
  sources: number;
  chunks: number;
  faqs: number;
  faqDraft: number;
  faqEnabled: number;
  entities: number;
}

export interface TenantReplySettings {
  tenantId: number;
  mode: ReplyMode;
  defaultKbId: number | null;
  dailyAiReplyLimit: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  blacklistKeywords: string[];
  customHandoffKeywords: string[];
}

export interface CustomerConversation {
  id: number;
  tenantId: number;
  slotId: number;
  phoneE164: string;
  stage: ConversationStage;
  kbId: number | null;
  lastCampaignTargetId: string | null;
  lastInboundAt: string | null;
  lastAiReplyAt: string | null;
  aiReplyCount24h: number;
  aiReplyCountTotal: number;
  openedAt: string;
  closedAt: string | null;
  summary: string | null;
}

// ── Knowledge Base ────────────────────────────────

export const kbApi = {
  async list(): Promise<KnowledgeBase[]> {
    const res = await api.get<KnowledgeBase[]>('/knowledge-base');
    return res.data;
  },
  async get(id: number): Promise<KnowledgeBase> {
    const res = await api.get<KnowledgeBase>(`/knowledge-base/${id}`);
    return res.data;
  },
  async stats(id: number): Promise<KbStats> {
    const res = await api.get<KbStats>(`/knowledge-base/${id}/stats`);
    return res.data;
  },
  async create(body: {
    name: string;
    description?: string;
    goalPrompt?: string;
    isDefault?: boolean;
  }): Promise<KnowledgeBase> {
    const res = await api.post<KnowledgeBase>('/knowledge-base', body);
    return res.data;
  },
  async update(
    id: number,
    body: Partial<{ name: string; description: string; goalPrompt: string; isDefault: boolean }>,
  ): Promise<KnowledgeBase> {
    const res = await api.patch<KnowledgeBase>(`/knowledge-base/${id}`, body);
    return res.data;
  },
  async remove(id: number): Promise<void> {
    await api.delete(`/knowledge-base/${id}`);
  },
  async uploadFile(id: number, file: File): Promise<KbSource> {
    const form = new FormData();
    form.append('file', file);
    const res = await api.post<KbSource>(`/knowledge-base/${id}/sources`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120_000,
    });
    return res.data;
  },
  async listSources(id: number): Promise<KbSource[]> {
    const res = await api.get<KbSource[]>(`/knowledge-base/${id}/sources`);
    return res.data;
  },
  async removeSource(id: number, sourceId: number): Promise<void> {
    await api.delete(`/knowledge-base/${id}/sources/${sourceId}`);
  },

  // FAQ
  async listFaqs(
    id: number,
    params: { status?: FaqStatus; source?: FaqSource } = {},
  ): Promise<KbFaq[]> {
    const res = await api.get<KbFaq[]>(`/knowledge-base/${id}/faqs`, { params });
    return res.data;
  },
  async createFaq(
    id: number,
    body: { question: string; answer: string; tags?: string[] },
  ): Promise<KbFaq> {
    const res = await api.post<KbFaq>(`/knowledge-base/${id}/faqs`, body);
    return res.data;
  },
  async bulkImport(
    id: number,
    items: Array<{ question: string; answer: string; tags?: string[] }>,
  ): Promise<{ added: number; skippedDup: number; skippedInvalid: number }> {
    const res = await api.post<{ added: number; skippedDup: number; skippedInvalid: number }>(
      `/knowledge-base/${id}/faqs/bulk`,
      { items },
    );
    return res.data;
  },
  async generateFaqs(id: number, count = 30): Promise<{ generated: number; skippedDup: number }> {
    const res = await api.post<{ generated: number; skippedDup: number }>(
      `/knowledge-base/${id}/faqs/generate`,
      { count },
      { timeout: 120_000 },
    );
    return res.data;
  },
  async approveAllDrafts(id: number): Promise<{ updated: number }> {
    const res = await api.post<{ updated: number }>(`/knowledge-base/${id}/faqs/approve-all-drafts`);
    return res.data;
  },
  // 2026-04-28 · 灌入 52 条通用 starter FAQ (问候/身份/转人工等)
  // id=0 → 自动找/建 default KB · 反之灌入指定 KB
  async seedCommonFaqs(
    id: number,
  ): Promise<{ kbId: number; inserted: number; skipped: number; created: boolean }> {
    const res = await api.post<{ kbId: number; inserted: number; skipped: number; created: boolean }>(
      `/knowledge-base/${id}/faqs/seed-common`,
    );
    return res.data;
  },
  // 2026-04-28 · 用租户 AI 改写 starter FAQ · 让答案贴合公司业务
  // 2026-04-29 · V2.4 · 加 force 参数
  //   不传 (默认): 仅处理还没 customized 过的 starter FAQ (旧行为)
  //   force=true: 也重新处理已 customized 过的 (覆盖旧答案)
  async customizeStarterFaqs(
    id: number,
    options: { force?: boolean } = {},
  ): Promise<{ processed: number; updated: number; skipped: number; failed: number; force?: boolean }> {
    const url = options.force
      ? `/knowledge-base/${id}/faqs/customize-starter?force=true`
      : `/knowledge-base/${id}/faqs/customize-starter`;
    const res = await api.post<{ processed: number; updated: number; skipped: number; failed: number; force?: boolean }>(
      url,
      undefined,
      { timeout: 600_000 }, // 50+ 条调 AI · 给 10min
    );
    return res.data;
  },
  async updateFaq(
    id: number,
    faqId: number,
    body: Partial<{ question: string; answer: string; tags: string[]; status: FaqStatus }>,
  ): Promise<KbFaq> {
    const res = await api.patch<KbFaq>(`/knowledge-base/${id}/faqs/${faqId}`, body);
    return res.data;
  },
  async removeFaq(id: number, faqId: number): Promise<void> {
    await api.delete(`/knowledge-base/${id}/faqs/${faqId}`);
  },

  // Protected
  async listProtected(id: number): Promise<KbProtectedEntity[]> {
    const res = await api.get<KbProtectedEntity[]>(`/knowledge-base/${id}/protected`);
    return res.data;
  },
  async addProtected(
    id: number,
    body: { entityType: 'phone' | 'email' | 'url' | 'company' | 'address'; value: string },
  ): Promise<KbProtectedEntity> {
    const res = await api.post<KbProtectedEntity>(`/knowledge-base/${id}/protected`, body);
    return res.data;
  },
  async removeProtected(id: number, entityId: number): Promise<void> {
    await api.delete(`/knowledge-base/${id}/protected/${entityId}`);
  },
};

// ── Reply Settings ────────────────────────────────

export const replySettingsApi = {
  async get(): Promise<TenantReplySettings> {
    const res = await api.get<TenantReplySettings>('/reply-settings');
    return res.data;
  },
  async update(body: Partial<Omit<TenantReplySettings, 'tenantId'>>): Promise<TenantReplySettings> {
    const res = await api.patch<TenantReplySettings>('/reply-settings', body);
    return res.data;
  },
};

// ── Conversations ─────────────────────────────────

export const conversationsApi = {
  async listPending(): Promise<CustomerConversation[]> {
    const res = await api.get<CustomerConversation[]>('/conversations/pending');
    return res.data;
  },
  async list(stages?: ConversationStage[]): Promise<CustomerConversation[]> {
    const res = await api.get<CustomerConversation[]>('/conversations', {
      params: stages ? { stage: stages.join(',') } : undefined,
    });
    return res.data;
  },
  async get(id: number): Promise<CustomerConversation> {
    const res = await api.get<CustomerConversation>(`/conversations/${id}`);
    return res.data;
  },
  async setStage(id: number, stage: ConversationStage): Promise<CustomerConversation> {
    const res = await api.patch<CustomerConversation>(`/conversations/${id}/stage`, { stage });
    return res.data;
  },
};
