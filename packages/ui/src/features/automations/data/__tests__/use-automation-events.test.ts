// @vitest-environment jsdom
/**
 * useAutomationEvents — daemonWs.onEvent singleton subscription patching the
 * automations store from the five `automation.*` WS events (contract §4).
 * Mirrors `use-workflows-events.test.tsx`'s harness (mock `daemonWs`
 * directly, capture the handler, fire synthetic events).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { DaemonEvent } from '../../contract';

let handler: (event: DaemonEvent) => void = () => {};
vi.mock('@/lib/daemon/ws-client', () => ({
  daemonWs: {
    onEvent: (h: (event: DaemonEvent) => void) => {
      handler = h;
      return () => {};
    },
  },
}));

import { useAutomationEvents } from '../use-automation-events';
import { useAutomationsStore } from '../use-automations-store';

const RUN_BASE = {
  id: 'run-1',
  automationId: 'auto-1',
  trigger: { kind: 'manual' as const },
  startedAt: 1,
  finishedAt: null,
  error: null,
};

const INTERACTION_BASE = {
  id: 'int-1',
  runId: 'run-1',
  stepRef: 'ask-1',
  title: 'Pick one',
  fields: [],
  status: 'pending' as const,
  createdAt: 1,
  resolvedAt: null,
};

beforeEach(() => {
  handler = () => {};
  useAutomationsStore.setState({ runs: [], interactions: [] });
});

describe('useAutomationEvents — automation.run.updated', () => {
  it('adds a new run to the store', () => {
    renderHook(() => useAutomationEvents());
    handler({ type: 'automation.run.updated', run: { ...RUN_BASE, status: 'running' } });
    expect(useAutomationsStore.getState().runs).toHaveLength(1);
    expect(useAutomationsStore.getState().runs[0]!.status).toBe('running');
  });

  it('patches an existing run in place rather than duplicating it', () => {
    useAutomationsStore.setState({ runs: [{ ...RUN_BASE, status: 'running' }] });
    renderHook(() => useAutomationEvents());
    handler({ type: 'automation.run.updated', run: { ...RUN_BASE, status: 'succeeded', finishedAt: 2 } });
    expect(useAutomationsStore.getState().runs).toHaveLength(1);
    expect(useAutomationsStore.getState().runs[0]!.status).toBe('succeeded');
  });
});

describe('useAutomationEvents — interactions', () => {
  it('adds an interaction on automation.interaction.created', () => {
    renderHook(() => useAutomationEvents());
    handler({ type: 'automation.interaction.created', interaction: INTERACTION_BASE });
    expect(useAutomationsStore.getState().interactions).toHaveLength(1);
    expect(useAutomationsStore.getState().interactions[0]!.id).toBe('int-1');
  });

  it('removes an interaction on automation.interaction.resolved', () => {
    useAutomationsStore.setState({ interactions: [INTERACTION_BASE] });
    renderHook(() => useAutomationEvents());
    handler({ type: 'automation.interaction.resolved', interactionId: 'int-1', runId: 'run-1' });
    expect(useAutomationsStore.getState().interactions).toHaveLength(0);
  });
});

describe('useAutomationEvents — automation.completed / automation.notification', () => {
  it('are switched on but patch nothing — use-automation-toasts.ts owns their user-facing behavior', () => {
    renderHook(() => useAutomationEvents());

    handler({
      type: 'automation.completed',
      automationId: 'auto-1',
      automationName: 'Daily standup',
      runId: 'run-1',
      status: 'succeeded',
      result: 'ok',
    });
    handler({
      type: 'automation.notification',
      runId: 'run-1',
      automationId: 'auto-1',
      title: 'Daily standup',
      body: 'Ready',
      links: { runId: 'run-1', chatIds: [] },
    });

    expect(useAutomationsStore.getState().runs).toHaveLength(0);
    expect(useAutomationsStore.getState().interactions).toHaveLength(0);
  });
});
