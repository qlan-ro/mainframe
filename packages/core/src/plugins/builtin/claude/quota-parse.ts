import type { ProviderQuota, QuotaWindow } from '@qlan-ro/mainframe-types';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('claude:quota');

// The prose region we parse ends here; everything below is the local
// "What's contributing" breakdown, which is never a quota source (#255).
const CONTRIBUTING_ANCHOR = /^What's contributing/i;
const SUBSCRIPTION_PREAMBLE = /using your subscription/i;
const NO_DATA = /only available (for|on)|subscription plan|api[- ]?key/i;

const SESSION_LINE = /^Current session:/i;
const WEEKLY_ALL_LINE = /^Current week \(all models\):/i;
const WEEKLY_MODEL_LINE = /^Current week \(([^)]+)\):/i;
const PERCENT = /(\d+)%\s+used/i;

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const RESET_RE = /resets\s+([A-Za-z]{3,})\s+(\d{1,2})\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^)]+)\)/i;

function unknown(observedAt: number): ProviderQuota {
  return { status: 'unknown', modelWindows: [], observedAt };
}

/**
 * Parse the human-prose output of `claude -p "/usage"` into a `ProviderQuota`.
 * Percent is load-bearing: any recognized window line without a percent, or any
 * unclassifiable non-empty line, fails the whole provider to `unknown` (#251).
 * Reset is best-effort: an unparseable reset nulls that window's `resetsAt` and
 * logs loudly, keeping the trustworthy percent.
 */
export function parseClaudeUsage(text: string, now: number): ProviderQuota {
  let session: QuotaWindow | undefined;
  let weekly: QuotaWindow | undefined;
  const modelWindows: QuotaWindow[] = [];
  let sawWindow = false;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (CONTRIBUTING_ANCHOR.test(line)) break;
    if (SUBSCRIPTION_PREAMBLE.test(line)) continue;
    if (NO_DATA.test(line)) {
      log.info({ line }, 'claude /usage: recognized no-data (non-subscriber)');
      return unknown(now);
    }

    if (SESSION_LINE.test(line)) {
      const w = parseWindow('session', line, now);
      if (!w) return failClosed(line, now);
      session = w;
    } else if (WEEKLY_ALL_LINE.test(line)) {
      const w = parseWindow('weekly', line, now);
      if (!w) return failClosed(line, now);
      weekly = w;
    } else {
      const m = WEEKLY_MODEL_LINE.exec(line);
      if (!m) {
        log.warn({ line }, 'claude /usage: unclassifiable line, failing provider to unknown');
        return unknown(now);
      }
      const w = parseWindow('weekly-model', line, now, m[1]);
      if (!w) return failClosed(line, now);
      modelWindows.push(w);
    }
    sawWindow = true;
  }

  if (!sawWindow) {
    log.info('claude /usage: no windows recognized, provider unknown');
    return unknown(now);
  }
  return { status: 'ok', observedAt: now, session, weekly, modelWindows };
}

function failClosed(line: string, now: number): ProviderQuota {
  log.warn({ line }, 'claude /usage: percent parse failed, failing provider to unknown');
  return unknown(now);
}

function parseWindow(
  kind: QuotaWindow['kind'],
  line: string,
  now: number,
  label?: string,
): QuotaWindow | null {
  const pm = PERCENT.exec(line);
  if (!pm) return null;
  const window: QuotaWindow = { kind, usedPercent: Number(pm[1]), resetsAt: parseResetToEpochMs(line, now) };
  if (label) window.label = label;
  return window;
}

function parseResetToEpochMs(line: string, now: number): number | null {
  const m = RESET_RE.exec(line);
  if (!m) {
    log.warn({ line }, 'claude /usage: reset unparseable, resetsAt=null');
    return null;
  }
  const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  if (month < 0) {
    log.warn({ line, month: m[1] }, 'claude /usage: reset month unrecognized, resetsAt=null');
    return null;
  }
  const day = Number(m[2]);
  const minute = m[4] ? Number(m[4]) : 0;
  const hour = (Number(m[3]) % 12) + (/pm/i.test(m[5]) ? 12 : 0);
  const zone = m[6].trim();
  try {
    return futureWallClockToEpochMs(new Date(now).getUTCFullYear(), month, day, hour, minute, zone, now);
  } catch {
    log.warn({ line, zone }, 'claude /usage: reset timezone conversion failed, resetsAt=null');
    return null;
  }
}

// A reset is always in the future; if this year's instant already passed, roll to next year.
function futureWallClockToEpochMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  zone: string,
  now: number,
): number {
  const epoch = wallClockInZoneToEpochMs(year, month, day, hour, minute, zone);
  return epoch < now ? wallClockInZoneToEpochMs(year + 1, month, day, hour, minute, zone) : epoch;
}

function wallClockInZoneToEpochMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  zone: string,
): number {
  const asUtc = Date.UTC(year, month, day, hour, minute);
  return asUtc - zoneOffsetMs(asUtc, zone);
}

// Offset (ms) the given zone is ahead of UTC at `instant`, via the wall-clock Intl renders there.
function zoneOffsetMs(instant: number, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asZone = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return asZone - instant;
}
