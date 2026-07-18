import { describe, it, expect, vi } from 'vitest';
import { handleNotification, type CodexSessionState } from '../event-mapper.js';
import type { SessionSink } from '@qlan-ro/mainframe-types';

const NULL_SINK: SessionSink = {
  onInit: vi.fn(),
  onMessage: vi.fn(),
  onToolResult: vi.fn(),
  onPermission: vi.fn(),
  onResult: vi.fn(),
  onExit: vi.fn(),
  onError: vi.fn(),
  onCompact: vi.fn(),
  onCompactStart: vi.fn(),
  onContextUsage: vi.fn(),
  onPlanFile: vi.fn(),
  onSkillFile: vi.fn(),
  onQueuedProcessed: vi.fn(),
  onTodoUpdate: vi.fn(),
  onPrDetected: vi.fn(),
  onCliMessage: vi.fn(),
  onSkillLoaded: vi.fn(),
  onSubagentChild: vi.fn(),
};

describe('Codex account/rateLimits/updated wiring', () => {
  it('emits a normalized ProviderQuota via onProviderQuota', () => {
    const onProviderQuota = vi.fn();
    const sink: SessionSink = { ...NULL_SINK, onProviderQuota };
    const state: CodexSessionState = { threadId: 't1', currentTurnId: null, currentTurnPlan: null };

    handleNotification(
      'account/rateLimits/updated',
      {
        rateLimits: {
          limitId: 'codex',
          limitName: null,
          primary: { usedPercent: 22, windowDurationMins: 10080, resetsAt: 1_784_845_911 },
          secondary: null,
        },
      },
      sink,
      state,
    );

    expect(onProviderQuota).toHaveBeenCalledTimes(1);
    const [adapterId, quota] = onProviderQuota.mock.calls[0];
    expect(adapterId).toBe('codex');
    expect(quota.weekly).toEqual({ kind: 'weekly', usedPercent: 22, resetsAt: 1_784_845_911_000 });
  });

  it('skips onProviderQuota when no window is recognized (C2 — never bump observedAt)', () => {
    const onProviderQuota = vi.fn();
    const sink: SessionSink = { ...NULL_SINK, onProviderQuota };
    const state: CodexSessionState = { threadId: 't1', currentTurnId: null, currentTurnPlan: null };

    handleNotification(
      'account/rateLimits/updated',
      {
        rateLimits: {
          limitId: 'codex',
          limitName: null,
          primary: { usedPercent: 40, windowDurationMins: 60, resetsAt: 1_784_845_911 },
          secondary: null,
        },
      },
      sink,
      state,
    );

    expect(onProviderQuota).not.toHaveBeenCalled();
  });

  it('no-ops when the sink has no onProviderQuota (optional sink method)', () => {
    const state: CodexSessionState = { threadId: 't1', currentTurnId: null, currentTurnPlan: null };
    expect(() =>
      handleNotification(
        'account/rateLimits/updated',
        { rateLimits: { limitId: 'codex', limitName: null, primary: null, secondary: null } },
        NULL_SINK,
        state,
      ),
    ).not.toThrow();
  });
});
