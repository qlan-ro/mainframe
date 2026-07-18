import { describe, it, expect } from 'vitest';
import { normalizeRateLimitSnapshot } from '../quota-rate-limit.js';

const NOW = 1_700_000_000_000;

describe('normalizeRateLimitSnapshot', () => {
  it('maps windowDurationMins 300 (primary) to a session window (percent as-is, sec→ms)', () => {
    const quota = normalizeRateLimitSnapshot(
      {
        limitId: 'codex',
        limitName: null,
        primary: { usedPercent: 22, windowDurationMins: 300, resetsAt: 1_784_845_911 },
        secondary: null,
      },
      NOW,
    );
    expect(quota).toEqual({
      status: 'ok',
      observedAt: NOW,
      modelWindows: [],
      session: { kind: 'session', usedPercent: 22, resetsAt: 1_784_845_911_000 },
    });
  });

  it('maps windowDurationMins 10080 (secondary) to a weekly window', () => {
    const quota = normalizeRateLimitSnapshot(
      {
        limitId: 'codex',
        limitName: null,
        primary: null,
        secondary: { usedPercent: 71, windowDurationMins: 10080, resetsAt: 1_784_845_911 },
      },
      NOW,
    );
    expect(quota?.weekly).toEqual({ kind: 'weekly', usedPercent: 71, resetsAt: 1_784_845_911_000 });
    expect(quota?.session).toBeUndefined();
  });

  it('window identity is by duration, not by slot — a weekly window reported as primary still maps to weekly', () => {
    const quota = normalizeRateLimitSnapshot(
      {
        limitId: 'codex',
        limitName: null,
        primary: { usedPercent: 22, windowDurationMins: 10080, resetsAt: 1_784_845_911 },
        secondary: null,
      },
      NOW,
    );
    expect(quota?.weekly?.usedPercent).toBe(22);
    expect(quota?.session).toBeUndefined();
  });

  it('sparse: both windows null leaves session and weekly unset (keep-previous, never clear)', () => {
    const quota = normalizeRateLimitSnapshot(
      { limitId: 'codex', limitName: null, primary: null, secondary: null },
      NOW,
    );
    expect(quota).toEqual({ status: 'ok', observedAt: NOW, modelWindows: [] });
  });

  it('keeps a null resetsAt as null (no synthesized value)', () => {
    const quota = normalizeRateLimitSnapshot(
      {
        limitId: 'codex',
        limitName: null,
        primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: null },
        secondary: null,
      },
      NOW,
    );
    expect(quota?.session).toEqual({ kind: 'session', usedPercent: 10, resetsAt: null });
  });

  it('drops a window whose windowDurationMins is unrecognized (untrusted, not session/weekly)', () => {
    const quota = normalizeRateLimitSnapshot(
      {
        limitId: 'codex',
        limitName: null,
        primary: { usedPercent: 40, windowDurationMins: 60, resetsAt: 1_784_845_911 },
        secondary: { usedPercent: 71, windowDurationMins: 10080, resetsAt: 1_784_845_911 },
      },
      NOW,
    );
    expect(quota?.session).toBeUndefined();
    expect(quota?.weekly?.usedPercent).toBe(71);
  });

  it('returns null when the only window is unclassifiable (C2 — skip ingest, no observedAt bump)', () => {
    const quota = normalizeRateLimitSnapshot(
      {
        limitId: 'codex',
        limitName: null,
        primary: { usedPercent: 40, windowDurationMins: null, resetsAt: 1_784_845_911 },
        secondary: null,
      },
      NOW,
    );
    expect(quota).toBeNull();
  });

  it('returns null when every present window is unrecognized (C2)', () => {
    const quota = normalizeRateLimitSnapshot(
      {
        limitId: 'codex',
        limitName: null,
        primary: { usedPercent: 40, windowDurationMins: 60, resetsAt: 1_784_845_911 },
        secondary: { usedPercent: 71, windowDurationMins: 120, resetsAt: 1_784_845_911 },
      },
      NOW,
    );
    expect(quota).toBeNull();
  });
});
