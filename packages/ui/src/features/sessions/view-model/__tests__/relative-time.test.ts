/**
 * Unit tests for formatRelativeTime.
 *
 * All dates are fixed — no current-time dependency in the helper or tests.
 *
 * Fixture base: "now" = 2025-06-07 15:00:00 UTC (1749308400000)
 *   - same day item  = 2025-06-07 09:30:00 UTC → HH:MM (locale time)
 *   - yesterday item = 2025-06-06 14:00:00 UTC → "Yest"
 *   - 3 days ago     = 2025-06-04 10:00:00 UTC → short weekday
 *   - 10 days ago    = 2025-05-28 10:00:00 UTC → "MMM D"
 *
 * Note: HH:MM and weekday strings are locale-dependent — we assert the
 * format shape (non-empty / contains digits / contains colon) rather than
 * exact strings, except for "Yest" which is our own constant.
 */
import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '../relative-time';

const NOW = new Date('2025-06-07T15:00:00Z').getTime();

const SAME_DAY = new Date('2025-06-07T09:30:00Z').getTime();
const YESTERDAY = new Date('2025-06-06T14:00:00Z').getTime();
const THREE_DAYS_AGO = new Date('2025-06-04T10:00:00Z').getTime();
const TEN_DAYS_AGO = new Date('2025-05-28T10:00:00Z').getTime();

describe('formatRelativeTime — same calendar day', () => {
  it('returns a string containing a colon (time format HH:MM)', () => {
    const result = formatRelativeTime(SAME_DAY, NOW);
    expect(result).toContain(':');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('formatRelativeTime — yesterday', () => {
  it('returns "Yest"', () => {
    expect(formatRelativeTime(YESTERDAY, NOW)).toBe('Yest');
  });
});

describe('formatRelativeTime — within 7 days (3 days ago)', () => {
  it('returns a non-empty weekday abbreviation (no colon, not "Yest")', () => {
    const result = formatRelativeTime(THREE_DAYS_AGO, NOW);
    expect(result).not.toContain(':');
    expect(result).not.toBe('Yest');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('formatRelativeTime — older than 7 days (10 days ago)', () => {
  it('returns a non-empty "MMM D" style string (no colon, not "Yest")', () => {
    const result = formatRelativeTime(TEN_DAYS_AGO, NOW);
    expect(result).not.toContain(':');
    expect(result).not.toBe('Yest');
    expect(result.length).toBeGreaterThan(0);
  });
});
