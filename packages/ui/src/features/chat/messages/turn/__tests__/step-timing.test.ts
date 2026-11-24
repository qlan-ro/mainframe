import { expect, it } from 'vitest';
import { formatStepDuration, formatTurnDuration } from '../../../format-step';
import { stepElapsedMs, stepElapsedTicks } from '../step-timing';

it('uses supplied intervals before reported duration and keeps subsecond completion', () => {
  expect(stepElapsedMs({ startedAt: 1000, completedAt: 1400 }, false, 5000, 9000)).toBe(400);
});
it('advances only genuine active intervals and never stamps terminal completion', () => {
  expect(stepElapsedMs({ startedAt: 1000 }, true, 5000)).toBe(4000);
  expect(stepElapsedMs({ startedAt: 1000 }, false, 5000)).toBeUndefined();
  expect(stepElapsedMs(undefined, false, 5000, 1200)).toBe(1200);
  expect(stepElapsedMs(undefined, true, 5000, 1200)).toBeUndefined();
});
it.each([
  { startedAt: -1 },
  { startedAt: NaN },
  { startedAt: Infinity },
  { startedAt: 6000 },
  { startedAt: 1000, completedAt: 900 },
  { startedAt: 1000, completedAt: Infinity },
])('rejects malformed/future intervals %j', (timing) => {
  expect(stepElapsedMs(timing, true, 5000)).toBeUndefined();
});
it.each([-1, NaN, Infinity])('rejects invalid reported duration %s', (duration) => {
  expect(stepElapsedMs(undefined, false, 5000, duration)).toBeUndefined();
});
it('ticks only while the reading still moves with the clock', () => {
  expect(stepElapsedTicks({ startedAt: 1000 }, true, 5000)).toBe(true);
  expect(stepElapsedTicks({ startedAt: 1000 }, false, 5000)).toBe(false);
  expect(stepElapsedTicks({ startedAt: 1000, completedAt: 4000 }, true, 5000)).toBe(false);
  // A completion the clock has not reached yet resolves on a later tick.
  expect(stepElapsedTicks({ startedAt: 1000, completedAt: 6000 }, false, 5000)).toBe(true);
  expect(stepElapsedTicks({ startedAt: NaN }, true, 5000)).toBe(false);
  expect(stepElapsedTicks(undefined, true, 5000)).toBe(false);
});

it.each([
  [400, '0.4s'],
  [6_800, '6.8s'],
  [38_400, '38s'],
  [64_000, '1m 04s'],
])('formats a step of %i ms as %s', (ms, expected) => expect(formatStepDuration(ms)).toBe(expected));
it.each([
  [0, '1s'],
  [18_400, '18s'],
  [134_000, '2m 14s'],
])('formats a turn of %i ms as %s', (ms, expected) => expect(formatTurnDuration(ms)).toBe(expected));
