import { describe, it, expect, vi, beforeEach } from 'vitest';
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
};

describe('Codex plan item capture', () => {
  let state: CodexSessionState;

  beforeEach(() => {
    state = { threadId: 't1', currentTurnId: 'turn1', currentTurnPlan: null };
  });

  it('accumulates plan delta text into currentTurnPlan', () => {
    handleNotification('item/plan/delta', { itemId: 'p1', delta: '# Plan\n' }, NULL_SINK, state);
    handleNotification('item/plan/delta', { itemId: 'p1', delta: 'Step 1\n' }, NULL_SINK, state);
    expect(state.currentTurnPlan).toEqual({ id: 'p1', text: '# Plan\nStep 1\n' });
  });

  it('finalises the plan when a plan item is emitted', () => {
    handleNotification('item/plan/delta', { itemId: 'p2', delta: 'partial' }, NULL_SINK, state);
    handleNotification('item/completed', { item: { id: 'p2', type: 'plan', text: 'complete plan' } }, NULL_SINK, state);
    expect(state.currentTurnPlan).toEqual({ id: 'p2', text: 'complete plan' });
  });

  it('clears currentTurnPlan on turn/started', () => {
    state.currentTurnPlan = { id: 'old', text: 'stale' };
    handleNotification('turn/started', { threadId: 't1', turn: { id: 'turn2' } }, NULL_SINK, state);
    expect(state.currentTurnPlan).toBeNull();
  });

  it('clears currentTurnPlan on turn/completed', () => {
    state.currentTurnPlan = { id: 'p', text: 'x' };
    handleNotification(
      'turn/completed',
      {
        threadId: 't1',
        turn: { id: 'turn1', status: 'completed', items: [], error: null },
      },
      NULL_SINK,
      state,
    );
    expect(state.currentTurnPlan).toBeNull();
  });
});
