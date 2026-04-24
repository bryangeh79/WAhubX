import { useEffect } from 'react';
import type { WizardDraft } from '../WizardContext';
import { DEFAULT_DRAFT } from '../WizardContext';

const KEY = 'wahubx_ad_wizard_draft';

// 2026-04-23 · localStorage 自动暂存 · 刷新不丢数据

export function loadDraft(): WizardDraft {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_DRAFT;
    const parsed = JSON.parse(raw) as WizardDraft;
    return { ...DEFAULT_DRAFT, ...parsed };
  } catch {
    return DEFAULT_DRAFT;
  }
}

export function saveDraft(d: WizardDraft): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* ignore */
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function useAutoSaveDraft(d: WizardDraft): void {
  useEffect(() => {
    saveDraft(d);
  }, [d]);
}
