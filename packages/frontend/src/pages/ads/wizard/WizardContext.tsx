import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react';
import {
  AdStrategy,
  ExecutionMode,
  OpeningStrategy,
  ThrottleProfile,
  type CampaignSchedule,
} from '@/lib/campaigns-api';

// 2026-04-23 · 向导 4 步共享 state · plan §F

export interface WizardDraft {
  name: string;
  schedule: CampaignSchedule;
  groupIds: number[];
  extraPhonesRaw: string;   // 用户输入的原始文本 · 提交时后端解析
  adStrategy: AdStrategy;
  adIds: number[];
  openingStrategy: OpeningStrategy;
  openingIds: number[];
  executionMode: ExecutionMode;
  customSlotIds: number[];
  throttleProfile: ThrottleProfile;
}

export const DEFAULT_DRAFT: WizardDraft = {
  name: '',
  schedule: { mode: 'immediate' },
  groupIds: [],
  extraPhonesRaw: '',
  adStrategy: AdStrategy.Single,
  adIds: [],
  openingStrategy: OpeningStrategy.Random,
  openingIds: [],
  executionMode: ExecutionMode.Smart,
  customSlotIds: [],
  throttleProfile: ThrottleProfile.Conservative,
};

type Action =
  | { type: 'patch'; patch: Partial<WizardDraft> }
  | { type: 'reset' };

function reducer(state: WizardDraft, action: Action): WizardDraft {
  if (action.type === 'reset') return { ...DEFAULT_DRAFT };
  if (action.type === 'patch') return { ...state, ...action.patch };
  return state;
}

interface CtxValue {
  draft: WizardDraft;
  patch: (p: Partial<WizardDraft>) => void;
  reset: () => void;
}

const Ctx = createContext<CtxValue | null>(null);

export function WizardProvider({ initial, children }: { initial?: WizardDraft; children: ReactNode }) {
  const [draft, dispatch] = useReducer(reducer, initial ?? DEFAULT_DRAFT);
  const value = useMemo<CtxValue>(
    () => ({
      draft,
      patch: (p) => dispatch({ type: 'patch', patch: p }),
      reset: () => dispatch({ type: 'reset' }),
    }),
    [draft],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWizard(): CtxValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWizard must be used inside WizardProvider');
  return v;
}

// 解析用户在第 1 步粘贴的号码, 返回 e164 数组
export function parseExtraPhones(raw: string): string[] {
  if (!raw) return [];
  const tokens = raw.split(/[,\s\n\r\t;]+/).map((t) => t.trim()).filter(Boolean);
  const uniq = new Set<string>();
  for (const t of tokens) {
    let s = t.trim();
    if (s.startsWith('+')) s = s.slice(1);
    s = s.replace(/\D/g, '');
    if (!s) continue;
    if (s.startsWith('00')) s = s.slice(2);
    if (s.startsWith('0') && s.length >= 9 && s.length <= 11) s = '60' + s.slice(1);
    if (s.length >= 8 && s.length <= 15) uniq.add(s);
  }
  return [...uniq];
}
