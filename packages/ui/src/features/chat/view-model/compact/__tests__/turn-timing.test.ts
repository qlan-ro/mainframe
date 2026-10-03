import { expect, it } from 'vitest';
import type { SourceUnit, TurnTiming } from '../turn-types';
import { turnDuration, verifiedTurnTiming } from '../turn-timing';

function unit(timing: TurnTiming, provider: 'codex' | 'claude' = 'codex'): SourceUnit {
  return {
    key: 'unit',
    index: 0,
    messageId: 'message',
    rootThreadId: 'root',
    ancestors: [],
    part: { type: 'reasoning', text: 'Thought', status: { type: 'complete' } },
    work: true,
    final: false,
    protected: false,
    presentation: {
      version: 1,
      provider,
      turnId: 'turn',
      phase: 'work',
      state: 'completed',
      finalEligible: false,
      timing,
    },
  };
}
it.each([1001, 1900, 2384, 2999])(
  'accepts precise Codex duration %i within whole-second endpoint precision',
  (durationMs) => {
    const timing = { startedAtMs: 10000, completedAtMs: 12000, durationMs };
    const verified = verifiedTurnTiming([unit(timing)], 15000);
    expect(verified).toEqual(timing);
    expect(turnDuration(verified, false, 15000)).toBe(durationMs);
  },
);
it.each([1000, 3000])('rejects duration %i at the impossible quantization boundary', (durationMs) => {
  expect(verifiedTurnTiming([unit({ startedAtMs: 10000, completedAtMs: 12000, durationMs })], 15000)).toBeUndefined();
});
it('does not infer Codex timestamp precision for other providers or non-whole-second endpoints', () => {
  const timing = { startedAtMs: 10000, completedAtMs: 12000, durationMs: 1900 };
  expect(verifiedTurnTiming([unit(timing, 'claude')], 15000)).toBeUndefined();
  expect(verifiedTurnTiming([unit({ ...timing, startedAtMs: 10001 })], 15000)).toBeUndefined();
  expect(verifiedTurnTiming([unit({ ...timing, durationMs: 2000 }, 'claude')], 15000)).toBeDefined();
});
it.each([
  { startedAtMs: 12000, completedAtMs: 10000, durationMs: 1900 },
  { startedAtMs: 10000, completedAtMs: 16000, durationMs: 6000 },
  { durationMs: -1 },
  { durationMs: Infinity },
  { durationMs: 1.5 },
  { durationMs: Number.MAX_SAFE_INTEGER + 1 },
])('rejects invalid ranges, order and future values: %j', (timing) => {
  expect(verifiedTurnTiming([unit(timing)], 15000)).toBeUndefined();
});
it('retains cross-source conflict rejection even inside the precision allowance', () => {
  const timing = { startedAtMs: 10000, completedAtMs: 12000, durationMs: 1900 };
  expect(verifiedTurnTiming([unit(timing), unit({ ...timing, durationMs: 1950 })], 15000)).toBeUndefined();
  expect(verifiedTurnTiming([unit(timing), unit({ ...timing, startedAtMs: 11000 })], 15000)).toBeUndefined();
});
