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
 *
 * Returns null when the snapshot carries at least one window but recognizes none of them
 * (every `windowDurationMins` unrecognized): the caller must skip the ingest entirely so a
 * fully-unrecognized snapshot never bumps observedAt. A snapshot with no windows at all
 * (both slots null) is a legitimate sparse "keep previous" update and yields an empty quota.
 */
export function normalizeRateLimitSnapshot(snapshot: RateLimitSnapshot, now: number): ProviderQuota | null {
  const quota: ProviderQuota = { status: 'ok', observedAt: now, modelWindows: [] };
  let sawWindow = false;
  let recognized = 0;
  for (const raw of [snapshot.primary, snapshot.secondary]) {
    if (raw) sawWindow = true;
    const mapped = mapWindow(raw);
    if (!mapped) continue;
    recognized += 1;
    if (mapped.kind === 'session') quota.session = mapped.window;
    else quota.weekly = mapped.window;
  }
  if (sawWindow && recognized === 0) {
    log.warn('codex rate limit: snapshot has windows but none recognized, skipping ingest');
    return null;
  }
  return quota;
}

function mapWindow(window: RateLimitWindow | null): { kind: 'session' | 'weekly'; window: QuotaWindow } | null {
  if (!window) return null;
  const kind = window.windowDurationMins != null ? KIND_BY_DURATION_MINS[window.windowDurationMins] : undefined;
  if (!kind) {
    log.warn(
      { windowDurationMins: window.windowDurationMins },
      'codex rate limit: unrecognized window duration, dropping window',
    );
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
