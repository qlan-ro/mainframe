/**
 * Unit tests for formatRelativeTime.
 *
 * All dates are fixed — no current-time dependency in the helper or tests.
 *
 * Fixture base: "now" = 2025-06-07 15:00:00 UTC (1749308400000)
 *   - same day, <60s ago  → "just now"
 *   - same day, minutes   → "Nm"
 *   - same day, hours     → "Nh"
 *   - yesterday item = 2025-06-06 14:00:00 UTC → "Yest"
 *   - 3 days ago     = 2025-06-04 10:00:00 UTC → short weekday
 *   - 10 days ago    = 2025-05-28 10:00:00 UTC → "MMM D"
 *
 * Note: weekday/month strings are locale-dependent — we assert the format
 * shape (non-empty / no colon) rather than exact strings, except "Yest"
 * and the duration-since strings, which are our own constants.
 */
import { describe, it, expect } from 'vitest';
import { formatRelativeTime } from '../relative-time';

const NOW = new Date('2025-06-07T15:00:00Z').getTime();

const JUST_NOW = NOW - 30_000;
const FIVE_MIN_AGO = NOW - 5 * 60_000;
const ONE_MIN_AGO = NOW - 60_000;
const THREE_HOURS_AGO = NOW - 3 * 3_600_000;
const ONE_HOUR_AGO = NOW - 3_600_000;
const YESTERDAY = new Date('2025-06-06T14:00:00Z').getTime();
const THREE_DAYS_AGO = new Date('2025-06-04T10:00:00Z').getTime();
const TEN_DAYS_AGO = new Date('2025-05-28T10:00:00Z').getTime();

describe('formatRelativeTime — same calendar day, duration-since', () => {
  it('returns "just now" for under 60 seconds ago', () => {
    expect(formatRelativeTime(JUST_NOW, NOW)).toBe('just now');
  });

  it('returns "just now" for exactly now (0ms elapsed)', () => {
    expect(formatRelativeTime(NOW, NOW)).toBe('just now');
  });

  it('returns "1m" for one minute ago', () => {
    expect(formatRelativeTime(ONE_MIN_AGO, NOW)).toBe('1m');
  });

  it('returns "5m" for five minutes ago', () => {
    expect(formatRelativeTime(FIVE_MIN_AGO, NOW)).toBe('5m');
  });

  it('returns "1h" for one hour ago', () => {
    expect(formatRelativeTime(ONE_HOUR_AGO, NOW)).toBe('1h');
  });

  it('returns "3h" for three hours ago', () => {
    expect(formatRelativeTime(THREE_HOURS_AGO, NOW)).toBe('3h');
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
