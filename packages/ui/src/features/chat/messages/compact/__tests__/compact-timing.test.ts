import { expect, it } from 'vitest';
import { compactElapsedMs, formatCompactElapsed } from '../compact-timing';

it('uses supplied intervals before reported duration and keeps subsecond completion', () => {
  expect(compactElapsedMs({ startedAt: 1000, completedAt: 1400 }, false, 5000, 9000)).toBe(400);
  expect(formatCompactElapsed(400)).toBe('0:00');
  expect(formatCompactElapsed(65000)).toBe('1:05');
});
it('advances only genuine active intervals and never stamps terminal completion', () => {
  expect(compactElapsedMs({ startedAt: 1000 }, true, 5000)).toBe(4000);
  expect(compactElapsedMs({ startedAt: 1000 }, false, 5000)).toBeUndefined();
  expect(compactElapsedMs(undefined, false, 5000, 1200)).toBe(1200);
  expect(compactElapsedMs(undefined, true, 5000, 1200)).toBeUndefined();
});
it.each([
  { startedAt: -1 },
  { startedAt: NaN },
  { startedAt: Infinity },
  { startedAt: 6000 },
  { startedAt: 1000, completedAt: 900 },
  { startedAt: 1000, completedAt: Infinity },
])('rejects malformed/future intervals %j', (timing) => {
  expect(compactElapsedMs(timing, true, 5000)).toBeUndefined();
});
it.each([-1, NaN, Infinity])('rejects invalid reported duration %s', (duration) => {
  expect(compactElapsedMs(undefined, false, 5000, duration)).toBeUndefined();
});
