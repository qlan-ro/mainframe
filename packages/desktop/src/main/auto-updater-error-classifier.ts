/**
 * Classifies auto-updater errors as transient or persistent.
 *
 * Transient errors (network unavailability, rate limits, server errors) are
 * expected to resolve on the next check cycle and should not surface as a
 * permanent error banner in the UI. Persistent errors (signature mismatch,
 * disk full, parse errors) indicate a real problem that needs user attention.
 */

export type UpdateErrorKind = 'transient' | 'persistent';

/** System-level network error codes that indicate temporary connectivity loss. */
const TRANSIENT_CODES = new Set([
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);

/** System-level error codes that indicate a real, non-network problem. */
const PERSISTENT_CODES = new Set(['ENOSPC', 'EPERM', 'EACCES']);

/** Patterns in error messages that indicate transient HTTP or network conditions. */
const TRANSIENT_MESSAGE_PATTERNS: RegExp[] = [
  // HTTP 5xx server errors
  /\bstatus\s+5\d{2}\b/i,
  // HTTP 429 Too Many Requests
  /\bstatus\s+429\b/i,
  // GitHub API rate limit returns 403 with a recognizable URL/message
  /\bstatus\s+403\b.*api\.github\.com/i,
  /api\.github\.com.*\bstatus\s+403\b/i,
  // Electron/Chromium network error strings
  /net::ERR_/i,
  // Generic "network" in message
  /network\s+(is\s+)?unavailable/i,
  /dns\s+(lookup\s+)?fail/i,
];

export function classifyUpdateError(err: Error): UpdateErrorKind {
  const code = (err as NodeJS.ErrnoException).code;

  if (code) {
    if (TRANSIENT_CODES.has(code)) return 'transient';
    if (PERSISTENT_CODES.has(code)) return 'persistent';
  }

  const msg = err.message ?? '';
  for (const pattern of TRANSIENT_MESSAGE_PATTERNS) {
    if (pattern.test(msg)) return 'transient';
  }

  return 'persistent';
}
