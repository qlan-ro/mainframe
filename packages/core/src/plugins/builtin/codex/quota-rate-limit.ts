import type { ProviderQuota, QuotaWindow } from '@qlan-ro/mainframe-types';
import type { RateLimitSnapshot, RateLimitWindow } from './types.js';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('codex:quota');

// windowDurationMins → our normalized kind. Window identity is by duration, never by
// primary/secondary slot — an account's only window can arrive in either slot.
const KIND_BY_DURATION_MINS: Record<number, 'session' | 'weekly'> = {
  300: 'session',
  10080: 'weekly',
};

/**
 * Normalize an `account/rateLimits/updated` (or `/read`) `RateLimitSnapshot` into a
 * `ProviderQuota` sparse update. A null window means "unknown, keep previous" (never
 * clear) — the caller merges this over the prior blob rather than replacing it. Percent
 * is already 0–100; `resetsAt` is unix seconds and normalizes to epoch ms.
 */
export function normalizeRateLimitSnapshot(snapshot: RateLimitSnapshot, now: number): ProviderQuota {
  const quota: ProviderQuota = { status: 'ok', observedAt: now, modelWindows: [] };
  for (const raw of [snapshot.primary, snapshot.secondary]) {
    const mapped = mapWindow(raw);
    if (!mapped) continue;
    if (mapped.kind === 'session') quota.session = mapped.window;
    else quota.weekly = mapped.window;
  }
  return quota;
}

function mapWindow(window: RateLimitWindow | null): { kind: 'session' | 'weekly'; window: QuotaWindow } | null {
  if (!window) return null;
  const kind = window.windowDurationMins != null ? KIND_BY_DURATION_MINS[window.windowDurationMins] : undefined;
  if (!kind) {
    log.warn({ windowDurationMins: window.windowDurationMins }, 'codex rate limit: unrecognized window duration, dropping window');
    return null;
  }
  return {
    kind,
    window: {
      kind,
      usedPercent: window.usedPercent,
      resetsAt: window.resetsAt == null ? null : window.resetsAt * 1000,
    },
  };
}
