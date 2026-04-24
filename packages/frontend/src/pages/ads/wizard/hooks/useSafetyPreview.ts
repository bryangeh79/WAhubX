import { useEffect, useRef, useState } from 'react';
import {
  campaignsApi,
  type CampaignSchedule,
  type CampaignTargets,
  ExecutionMode,
  type SafetyPreview,
  type ThrottleProfile,
} from '@/lib/campaigns-api';

// 2026-04-23 · 向导 Step 3 用的 承载预览 hook · debounce 400ms

export function useSafetyPreview(args: {
  enabled: boolean;
  schedule: CampaignSchedule;
  targets: CampaignTargets;
  executionMode: ExecutionMode;
  customSlotIds?: number[];
  throttleProfile: ThrottleProfile;
}) {
  const [preview, setPreview] = useState<SafetyPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!args.enabled) {
      setPreview(null);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setLoading(true);
      setError(null);
      campaignsApi
        .previewSafety({
          schedule: args.schedule,
          targets: args.targets,
          executionMode: args.executionMode,
          customSlotIds: args.customSlotIds,
          throttleProfile: args.throttleProfile,
        })
        .then((p) => setPreview(p))
        .catch((e: unknown) => setError(e instanceof Error ? e.message : '预览失败'))
        .finally(() => setLoading(false));
    }, 400);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    args.enabled,
    JSON.stringify(args.schedule),
    JSON.stringify(args.targets),
    args.executionMode,
    JSON.stringify(args.customSlotIds ?? []),
    args.throttleProfile,
  ]);

  return { preview, loading, error };
}
