import { describe, expect, it } from 'vitest';
import { formatCompactTime } from '../compact-time';

const NOW = new Date('2026-08-04T12:00:00Z').getTime();
const ago = (ms: number) => formatCompactTime(NOW - ms, NOW);

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

describe('formatCompactTime', () => {
  it('reads "now" under a minute', () => {
    expect(ago(0)).toBe('now');
    expect(ago(59 * SECOND)).toBe('now');
  });

  it('steps up a unit at each exact boundary', () => {
    expect(ago(MINUTE)).toBe('1m');
    expect(ago(HOUR)).toBe('1h');
    expect(ago(DAY)).toBe('1d');
    expect(ago(WEEK)).toBe('1w');
    expect(ago(MONTH)).toBe('1mo');
    expect(ago(YEAR)).toBe('1y');
  });

  it('holds each unit to the last moment before the next', () => {
    expect(ago(59 * MINUTE)).toBe('59m');
    expect(ago(23 * HOUR)).toBe('23h');
    expect(ago(6 * DAY)).toBe('6d');
    expect(ago(MONTH - DAY)).toBe('4w');
    expect(ago(YEAR - DAY)).toBe('12mo');
  });

  it('spells months "mo" so they cannot be read as minutes', () => {
    expect(ago(5 * MONTH)).toBe('5mo');
    expect(ago(5 * MINUTE)).toBe('5m');
  });

  it('keeps counting years rather than falling back to a date', () => {
    expect(ago(3 * YEAR)).toBe('3y');
  });

  it('floors rather than rounds, so a label never claims more elapsed than has passed', () => {
    expect(ago(HOUR + 59 * MINUTE)).toBe('1h');
    expect(ago(2 * DAY - SECOND)).toBe('1d');
    expect(ago(2 * YEAR - DAY)).toBe('1y');
  });

  it('clamps a future timestamp to "now" instead of rendering a negative', () => {
    expect(formatCompactTime(NOW + 5 * MINUTE, NOW)).toBe('now');
  });
});
