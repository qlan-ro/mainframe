import type { ProviderQuota, QuotaWindow } from '@qlan-ro/mainframe-types';

// Claude's `rateLimitType` wire values → our normalized window kind + label.
// `overage` is intentionally absent: it is a paid-credit bucket, not a plan window.
const KIND_BY_TYPE: Record<string, { kind: QuotaWindow['kind']; label?: string }> = {
  five_hour: { kind: 'session' },
  seven_day: { kind: 'weekly' },
  seven_day_opus: { kind: 'weekly-model', label: 'opus' },
  seven_day_sonnet: { kind: 'weekly-model', label: 'sonnet' },
};

/**
 * Normalize a stream-json `rate_limit_event`'s `rate_limit_info` into a partial
 * `ProviderQuota` escalation. Returns `null` when it carries no usable percent —
 * `utilization` is only populated in warning/rejected states, so a healthy event
 * cannot drive an ambient gauge and is dropped. Unit trap: `utilization` is a
 * 0–1 fraction and `resetsAt` is epoch seconds; both normalize to percent 0–100
 * and epoch ms.
 */
export function normalizeRateLimitEvent(
  info: Record<string, unknown> | undefined,
  now: number,
): ProviderQuota | null {
  if (!info) return null;
  const { utilization, rateLimitType } = info;
  if (typeof utilization !== 'number' || typeof rateLimitType !== 'string') return null;
  const mapping = KIND_BY_TYPE[rateLimitType];
  if (!mapping) return null;

  const window: QuotaWindow = {
    kind: mapping.kind,
    usedPercent: Math.round(utilization * 100),
    resetsAt: typeof info.resetsAt === 'number' ? info.resetsAt * 1000 : null,
  };
  if (mapping.label) window.label = mapping.label;

  const quota: ProviderQuota = { status: 'ok', observedAt: now, modelWindows: [] };
  if (mapping.kind === 'session') quota.session = window;
  else if (mapping.kind === 'weekly') quota.weekly = window;
  else quota.modelWindows = [window];
  return quota;
}
