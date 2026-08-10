/**
 * format-duration — the chat's two duration readouts.
 *
 * Every expectation is a hardcoded string, not a re-derivation of the
 * formatters' own arithmetic.
 *
 * Behaviors covered:
 *  - formatElapsedSeconds: the three bands (seconds, minutes, hours), their
 *    boundaries, and the negative clamp
 *  - formatDurationMs: the sub-second band, the fractional-second band, and the
 *    handoff to the banded readout so a long turn never renders raw seconds
 */
import { describe, expect, it } from 'vitest';
import { formatDurationMs, formatElapsedSeconds } from '../format-duration';

describe('formatElapsedSeconds', () => {
  it('reports whole seconds below a minute', () => {
    expect(formatElapsedSeconds(0)).toBe('0s');
    expect(formatElapsedSeconds(1)).toBe('1s');
    expect(formatElapsedSeconds(9)).toBe('9s');
    expect(formatElapsedSeconds(59)).toBe('59s');
  });

  it('switches to minutes at 60s, zero-padding the seconds so a ticking readout keeps its width', () => {
    expect(formatElapsedSeconds(60)).toBe('1m 00s');
    expect(formatElapsedSeconds(65)).toBe('1m 05s');
    expect(formatElapsedSeconds(75)).toBe('1m 15s');
    expect(formatElapsedSeconds(600)).toBe('10m 00s');
    expect(formatElapsedSeconds(3599)).toBe('59m 59s');
  });

  it('drops seconds past an hour', () => {
    expect(formatElapsedSeconds(3600)).toBe('1h 00m');
    expect(formatElapsedSeconds(3725)).toBe('1h 02m');
    expect(formatElapsedSeconds(7380)).toBe('2h 03m');
  });

  it('clamps a negative reading to zero', () => {
    expect(formatElapsedSeconds(-5)).toBe('0s');
  });
});

describe('formatDurationMs', () => {
  it('reports whole milliseconds below a second', () => {
    expect(formatDurationMs(0)).toBe('0ms');
    expect(formatDurationMs(412)).toBe('412ms');
    expect(formatDurationMs(999.4)).toBe('999ms');
  });

  it('keeps the fractional second between 1s and a minute', () => {
    expect(formatDurationMs(999.6)).toBe('1.00s');
    expect(formatDurationMs(1000)).toBe('1.00s');
    expect(formatDurationMs(8940)).toBe('8.94s');
    expect(formatDurationMs(59_940)).toBe('59.94s');
  });

  it('bands minutes and hours instead of running the seconds up', () => {
    expect(formatDurationMs(60_000)).toBe('1m 00s');
    expect(formatDurationMs(75_000)).toBe('1m 15s');
    expect(formatDurationMs(3_600_000)).toBe('1h 00m');
    expect(formatDurationMs(8_158_940)).toBe('2h 15m');
  });

  it('clamps a negative reading to zero', () => {
    expect(formatDurationMs(-5)).toBe('0ms');
  });
});
