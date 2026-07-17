// @vitest-environment jsdom
/**
 * useAutomationToasts — daemon-driven toast notifications for automation
 * events (ts153 has no artboard for this; ported from the v1
 * `use-workflows-toasts.ts` precedent, subscribing through
 * `gateway.onEvent` instead of `daemonWs.onEvent` directly — the fixture
 * gateway's local emitter works standalone; Phase 6's http-gateway wraps
 * daemonWs behind the same shape).
 *
 * Pins:
 *   automation.notification (no chatIds)  → mfToast with a "View run" action
 *   automation.notification (chatIds)     → mfToast with a chatId (native "Open session" CTA)
 *   automation.completed (succeeded)      → mfToast.success + "View run" action
 *   automation.completed (failed)         → mfToast.error + "View run" action
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { DaemonEvent } from '../../contract';

vi.mock('@/lib/toast', () => {
  const successFn = vi.fn();
  const errorFn = vi.fn();
  return {
    mfToast: Object.assign(vi.fn(), { success: successFn, error: errorFn, warning: vi.fn(), info: vi.fn() }),
  };
});

import { createFakeGateway } from './fake-gateway';
import { useAutomationsNav } from '../use-automations-nav';
import { useAutomationsStore } from '../use-automations-store';
import { useAutomationToasts } from '../use-automation-toasts';
import { mfToast } from '@/lib/toast';

let handler: (event: DaemonEvent) => void = () => {};

function mountWithHandler() {
  const onEvent = vi.fn((h: (event: DaemonEvent) => void) => {
    handler = h;
    return () => {};
  });
  useAutomationsStore.setState({ gateway: createFakeGateway({ onEvent }) });
  renderHook(() => useAutomationToasts());
}

beforeEach(() => {
  handler = () => {};
  vi.clearAllMocks();
  useAutomationsNav.setState({ open: false, runId: null, editorTarget: null });
});

describe('useAutomationToasts — automation.notification', () => {
  it('fires an info toast with a "View run" action when there are no chat ids', () => {
    mountWithHandler();
    handler({
      type: 'automation.notification',
      runId: 'run-1',
      automationId: 'auto-1',
      title: 'Daily health log',
      body: 'Health check-in is waiting for you',
      links: { runId: 'run-1', chatIds: [] },
    });

    expect(mfToast).toHaveBeenCalledOnce();
    const [call] = vi.mocked(mfToast).mock.calls[0]!;
    expect(call.title).toBe('Daily health log');
    expect(call.description).toBe('Health check-in is waiting for you');
    expect(call.action?.label).toBe('View run');
    expect(call.chatId).toBeUndefined();
  });

  it("View run opens the host and navigates to the notification's run", () => {
    mountWithHandler();
    handler({
      type: 'automation.notification',
      runId: 'run-2',
      automationId: 'auto-1',
      title: 'Daily health log',
      body: 'Waiting',
      links: { runId: 'run-2', chatIds: [] },
    });

    const [call] = vi.mocked(mfToast).mock.calls[0]!;
    call.action!.onClick();

    expect(useAutomationsNav.getState().open).toBe(true);
    expect(useAutomationsNav.getState().runId).toBe('run-2');
  });

  it('passes the first chatId (native "Open session" CTA) instead of an action when chat ids are present', () => {
    mountWithHandler();
    handler({
      type: 'automation.notification',
      runId: 'run-3',
      automationId: 'auto-1',
      title: 'Daily standup',
      body: 'Your day plan is ready',
      links: { runId: 'run-3', chatIds: ['chat-1', 'chat-2'] },
    });

    const [call] = vi.mocked(mfToast).mock.calls[0]!;
    expect(call.chatId).toBe('chat-1');
    expect(call.action).toBeUndefined();
  });
});

describe('useAutomationToasts — automation.completed', () => {
  it('fires a success toast with a "View run" action on status:succeeded', () => {
    mountWithHandler();
    handler({
      type: 'automation.completed',
      automationId: 'auto-1',
      automationName: 'Daily standup',
      runId: 'run-4',
      status: 'succeeded',
      result: 'ok',
    });

    expect(mfToast.success).toHaveBeenCalledOnce();
    const [title, opts] = vi.mocked(mfToast.success).mock.calls[0]!;
    expect(title).toContain('Daily standup');
    expect(opts?.action?.label).toBe('View run');

    opts!.action!.onClick();
    expect(useAutomationsNav.getState().runId).toBe('run-4');
  });

  it('fires an error toast with the result as description on status:failed', () => {
    mountWithHandler();
    handler({
      type: 'automation.completed',
      automationId: 'auto-1',
      automationName: 'PR auto-review',
      runId: 'run-5',
      status: 'failed',
      result: 'worktree was locked',
    });

    expect(mfToast.error).toHaveBeenCalledOnce();
    const [title, opts] = vi.mocked(mfToast.error).mock.calls[0]!;
    expect(title).toContain('PR auto-review');
    expect(opts?.description).toBe('worktree was locked');
    expect(opts?.action?.label).toBe('View run');
  });
});

describe('useAutomationToasts — other events', () => {
  it('ignores automation.run.updated / interaction events (no toast)', () => {
    mountWithHandler();
    handler({
      type: 'automation.run.updated',
      run: {
        id: 'run-6',
        automationId: 'auto-1',
        status: 'running',
        trigger: { kind: 'manual' },
        startedAt: 1,
        finishedAt: null,
        error: null,
      },
    });

    expect(mfToast).not.toHaveBeenCalled();
    expect(mfToast.success).not.toHaveBeenCalled();
    expect(mfToast.error).not.toHaveBeenCalled();
  });
});
