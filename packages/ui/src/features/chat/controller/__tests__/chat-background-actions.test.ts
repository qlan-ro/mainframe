/**
 * Behavior tests for stop/dismiss background-task actions, and the
 * send/retry `background.turn.started` dispatch (todo #328). A hand-rolled
 * `ChatActionHost` backed by the real reducer stands in for the controller —
 * these are host-level action tests, not full-controller tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackgroundActivityTask } from '@qlan-ro/mainframe-types';

vi.mock('../../../../lib/api/background-tasks', () => ({ killBackgroundTask: vi.fn() }));
vi.mock('../../../../lib/api/attachments', () => ({ uploadAttachments: vi.fn() }));
vi.mock('@/lib/toast', () => ({
  mfToast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), permission: vi.fn() },
}));

import { killBackgroundTask } from '../../../../lib/api/background-tasks';
import { dismissBackgroundTask, stopBackgroundTask } from '../chat-background-actions';
import { retryChatMessage, sendChatMessage, type ChatActionHost } from '../chat-actions';
import {
  createChatThreadState,
  reduceChatThreadState,
  type ChatThreadState,
  type ChatStateEvent,
} from '../chat-thread-state';
import { makeMsg } from './acp-test-kit';

const CHAT_ID = 'chat-1';

function task(id: string, overrides: Partial<BackgroundActivityTask> = {}): BackgroundActivityTask {
  return { id, kind: 'bash', description: `desc-${id}`, startedAt: 1000, status: 'running', ...overrides };
}

function makeHost(initial: ChatThreadState): { host: ChatActionHost; getState: () => ChatThreadState } {
  let state = initial;
  const host: ChatActionHost = {
    getPort: () => 31415,
    getDaemonId: () => CHAT_ID,
    getState: () => state,
    dispatch: (event: ChatStateEvent) => {
      state = reduceChatThreadState(state, event);
    },
    load: () => Promise.resolve(),
    sendPrompt: () => Promise.resolve({ queued: false }),
  };
  return { host, getState: () => state };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('stopBackgroundTask', () => {
  it('dispatches stop.requested then calls kill exactly once per activation', async () => {
    let state = createChatThreadState(CHAT_ID);
    state = reduceChatThreadState(state, { type: 'background.upsert', task: task('a-1') });
    const { host, getState } = makeHost(state);
    vi.mocked(killBackgroundTask).mockResolvedValue({ kind: 'ok' });

    await stopBackgroundTask(host, 'a-1');

    expect(killBackgroundTask).toHaveBeenCalledTimes(1);
    expect(killBackgroundTask).toHaveBeenCalledWith(CHAT_ID, 'a-1');
    expect(getState().backgroundStops['a-1']).toEqual({ phase: 'stopping' });
  });

  it('ok, then an ended event before the timeout, settles with no timeout dispatch', async () => {
    let state = createChatThreadState(CHAT_ID);
    state = reduceChatThreadState(state, { type: 'background.upsert', task: task('a-1') });
    const { host, getState } = makeHost(state);
    vi.mocked(killBackgroundTask).mockResolvedValue({ kind: 'ok' });

    await stopBackgroundTask(host, 'a-1');
    host.dispatch({ type: 'background.ended', task: task('a-1', { status: 'stopped', endedAt: 2000 }) });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(getState().backgroundTasks['a-1']!.status).toBe('stopped');
    expect(getState().backgroundStops['a-1']).toBeUndefined();
  });

  it('ok, then 10s with no ended event, dispatches the timeout stop.failed (AC4)', async () => {
    let state = createChatThreadState(CHAT_ID);
    state = reduceChatThreadState(state, { type: 'background.upsert', task: task('a-1') });
    const { host, getState } = makeHost(state);
    vi.mocked(killBackgroundTask).mockResolvedValue({ kind: 'ok' });

    await stopBackgroundTask(host, 'a-1');
    await vi.advanceTimersByTimeAsync(10_000);

    expect(getState().backgroundStops['a-1']).toEqual({
      phase: 'error',
      message: 'Stop requested, but the task is still running.',
    });
  });

  it('not-found removes the row (AC5)', async () => {
    let state = createChatThreadState(CHAT_ID);
    state = reduceChatThreadState(state, { type: 'background.upsert', task: task('a-1') });
    const { host, getState } = makeHost(state);
    vi.mocked(killBackgroundTask).mockResolvedValue({ kind: 'not-found' });

    await stopBackgroundTask(host, 'a-1');

    expect(getState().backgroundTasks['a-1']).toBeUndefined();
  });

  it('an error surfaces a message containing the daemon text; a retry sends another kill (AC3)', async () => {
    let state = createChatThreadState(CHAT_ID);
    state = reduceChatThreadState(state, { type: 'background.upsert', task: task('a-1') });
    const { host, getState } = makeHost(state);
    vi.mocked(killBackgroundTask).mockResolvedValue({ kind: 'error', message: 'no live writer' });

    await stopBackgroundTask(host, 'a-1');

    expect(getState().backgroundStops['a-1']).toEqual({
      phase: 'error',
      message: "Couldn't stop this task: no live writer",
    });

    await stopBackgroundTask(host, 'a-1');
    expect(killBackgroundTask).toHaveBeenCalledTimes(2);
  });
});

describe('dismissBackgroundTask', () => {
  it('dispatches background.dismissed, removing a terminal row', () => {
    let state = createChatThreadState(CHAT_ID);
    state = reduceChatThreadState(state, { type: 'background.upsert', task: task('a-1') });
    state = reduceChatThreadState(state, {
      type: 'background.ended',
      task: task('a-1', { status: 'completed', endedAt: 2000 }),
    });
    const { host, getState } = makeHost(state);

    dismissBackgroundTask(host, 'a-1');

    expect(getState().backgroundTasks['a-1']).toBeUndefined();
  });
});

describe('sendChatMessage / retryChatMessage — background.turn.started', () => {
  it('a send clears terminal rows while running rows are untouched', async () => {
    let state = createChatThreadState(CHAT_ID);
    state = reduceChatThreadState(state, { type: 'background.upsert', task: task('running-1') });
    state = reduceChatThreadState(state, {
      type: 'background.ended',
      task: task('done-1', { status: 'completed', endedAt: 2000 }),
    });
    // `background.ended` no-ops for a never-listed id — upsert it running first, then end it.
    state = reduceChatThreadState(state, { type: 'background.upsert', task: task('done-1') });
    state = reduceChatThreadState(state, {
      type: 'background.ended',
      task: task('done-1', { status: 'completed', endedAt: 2000 }),
    });
    const { host, getState } = makeHost(state);

    await sendChatMessage(host, makeMsg('hello'));

    expect(getState().backgroundTasks).toEqual({ 'running-1': task('running-1') });
  });

  it('a retry also clears terminal rows while running rows are untouched', async () => {
    let state = createChatThreadState(CHAT_ID);
    state = reduceChatThreadState(state, { type: 'background.upsert', task: task('running-1') });
    const { host, getState: getStateAfterSetup } = makeHost(state);
    await sendChatMessage(host, makeMsg('first'));
    const clientId = Object.keys(getStateAfterSetup().pendingUserMessages)[0]!;
    host.dispatch({
      type: 'local.message.failed',
      clientId,
      error: new Error('boom'),
      stage: 'send',
      pending: getStateAfterSetup().pendingUserMessages[clientId]!,
    });
    host.dispatch({ type: 'background.upsert', task: task('done-1') });
    host.dispatch({ type: 'background.ended', task: task('done-1', { status: 'completed', endedAt: 2000 }) });

    await retryChatMessage(host, clientId);

    expect(getStateAfterSetup().backgroundTasks).toEqual({ 'running-1': task('running-1') });
  });
});
