/**
 * useComposerStop (C8) — Stop ends the turn and every sub-agent, with no
 * confirmation; its target names what it will end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

let mockRunning = false;
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (select: (s: { thread: { isRunning: boolean } }) => unknown) =>
    select({ thread: { isRunning: mockRunning } }),
}));

vi.mock('@/lib/api/background-tasks', () => ({
  stopBackgroundTask: vi.fn().mockResolvedValue(undefined),
  cancelDelegatedTask: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/toast', () => ({ mfToast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../focus-composer', () => ({ focusVisibleComposer: vi.fn() }));
vi.mock('../../../orchestration/use-session-items', () => ({ useSessionItems: () => [] }));

let mockDelegated: Array<{ taskId: string; status: string; resumedState?: string }> = [];
vi.mock('@/features/sessions/view-model/agent-provenance', () => ({ delegatedTasksOf: () => mockDelegated }));

let mockExtras: unknown;
vi.mock('../../../runtime/chat-extras', () => ({ useChatExtras: () => mockExtras }));

import { mfToast } from '@/lib/toast';
import { cancelDelegatedTask, stopBackgroundTask } from '@/lib/api/background-tasks';
import { useHeldQueue } from '../../queue/held-queue-store';
import { useComposerStop } from '../use-stop';

const toast = vi.mocked(mfToast);
const cancel = vi.fn().mockResolvedValue(undefined);

const task = (id: string, kind: string) => ({ id, kind });

function setup(opts: {
  running?: boolean;
  adapterId?: string;
  tasks?: Array<{ id: string; kind: string }>;
  delegated?: typeof mockDelegated;
  runState?: string;
}) {
  mockRunning = opts.running ?? false;
  mockDelegated = opts.delegated ?? [];
  mockExtras = {
    cancel,
    state: {
      chatId: 'chat-1',
      chatConfig: { adapterId: opts.adapterId ?? 'claude' },
      backgroundTasks: Object.fromEntries((opts.tasks ?? []).map((t) => [t.id, t])),
      runState: { type: opts.runState ?? 'idle' },
    },
  };
  return renderHook(() => useComposerStop());
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useComposerStop — what Stop offers and names', () => {
  it('is unavailable when nothing runs', () => {
    expect(setup({}).result.current.available).toBe(false);
  });

  it('names "the turn" for a running turn alone', () => {
    const { result } = setup({ running: true });

    expect(result.current).toMatchObject({ available: true, target: 'the turn' });
  });

  it('names the turn and its sub-agents, counting agents and workflows of an adapter that can stop them', () => {
    const { result } = setup({
      running: true,
      tasks: [task('a', 'agent'), task('w', 'workflow'), task('c', 'command'), task('m', 'monitor')],
      delegated: [{ taskId: 't1', status: 'running' }],
    });

    expect(result.current.target).toBe('the turn and 3 sub-agents');
  });

  it('says "1 sub-agent" in the singular', () => {
    const { result } = setup({ running: true, delegated: [{ taskId: 't1', status: 'queued' }] });

    expect(result.current.target).toBe('the turn and 1 sub-agent');
  });

  it('is available for sub-agents alone, naming only them', () => {
    const { result } = setup({
      running: false,
      delegated: [
        { taskId: 't1', status: 'running' },
        { taskId: 't2', status: 'waiting' },
      ],
    });

    expect(result.current).toMatchObject({ available: true, target: '2 sub-agents' });
  });

  it('does not count finished or already-resumed delegated tasks', () => {
    const { result } = setup({
      running: true,
      delegated: [
        { taskId: 'done', status: 'completed' },
        { taskId: 'resumed', status: 'running', resumedState: 'running' },
      ],
    });

    expect(result.current.target).toBe('the turn');
  });

  it('does not count background agents of an adapter that cannot stop them one by one', () => {
    const { result } = setup({ running: true, adapterId: 'codex', tasks: [task('a', 'agent')] });

    expect(result.current.target).toBe('the turn');
  });

  it('reports stopping while the run is cancelling', () => {
    expect(setup({ running: true, runState: 'cancelling' }).result.current.stopping).toBe(true);
  });
});

describe('useComposerStop — stopping', () => {
  it('cancels the turn and stops each sub-agent, then says what it stopped', async () => {
    const { result } = setup({
      running: true,
      tasks: [task('a', 'agent')],
      delegated: [{ taskId: 't1', status: 'running' }],
    });

    act(() => result.current.stop());

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stopBackgroundTask).toHaveBeenCalledExactlyOnceWith('chat-1', 'a');
    expect(cancelDelegatedTask).toHaveBeenCalledExactlyOnceWith('chat-1', 't1');
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledExactlyOnceWith('Stopped · 2 sub-agents stopped'));
  });

  it('stops sub-agents without cancelling a turn when only they run', async () => {
    const { result } = setup({ running: false, delegated: [{ taskId: 't1', status: 'running' }] });

    act(() => result.current.stop());

    expect(cancel).not.toHaveBeenCalled();
    expect(cancelDelegatedTask).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledExactlyOnceWith('Stopped 1 sub-agent'));
  });

  it('cancels the held rows not yet sent, with only sub-agents running too', () => {
    useHeldQueue.getState().hold('chat-1', {
      messageId: 'm1',
      chatId: 'chat-1',
      uuid: 'u1',
      content: 'held',
      timestamp: '2026-11-24T10:00:01.000Z',
    });
    useHeldQueue.getState().claimFrom('chat-1', 'm1', 'p1');
    const { result } = setup({ running: false, delegated: [{ taskId: 't1', status: 'running' }] });

    act(() => result.current.stop());

    expect(useHeldQueue.getState().startSending('chat-1', 'm1', 'p1')).toBe(false);
  });

  it('does nothing when nothing runs', () => {
    const { result } = setup({});

    act(() => result.current.stop());

    expect(cancel).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('does nothing again while already stopping', () => {
    const { result } = setup({ running: true, runState: 'cancelling' });

    act(() => result.current.stop());

    expect(cancel).not.toHaveBeenCalled();
  });

  it('reports a failed stop without hiding the others', async () => {
    cancel.mockRejectedValueOnce(new Error('daemon gone'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = setup({ running: true });

    await act(async () => result.current.stop());

    expect(toast.error).toHaveBeenCalledExactlyOnceWith('Could not stop everything', { description: 'daemon gone' });
  });
});
