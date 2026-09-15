// @vitest-environment jsdom
/**
 * useInstructionActions — behavior tests for the two chip actions (AC #278.3, #278.4, #278.7).
 *
 * Both actions are prefill-only: neither may reach a send API. "Run in a new
 * session" has a load-bearing call ORDER — reset the reused draft slot, await
 * the thread switch (#212), initialize the draft, and only then set the text —
 * so the order is asserted, not just the individual calls.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';

// ── Call-order ledger, shared by every seam spy ──────────────────────────────
const calls: string[] = [];

// ── assistant-ui seams ───────────────────────────────────────────────────────
const setText = vi.fn((text: string) => {
  calls.push(`setText:${text}`);
});
const send = vi.fn();
const append = vi.fn();
const switchToNewThread = vi.fn(async () => {
  calls.push('switchToNewThread');
});
const switchToThread = vi.fn();
const getComposerState = vi.fn(() => ({ text: '' }));
let newThreadId: string | null = '__LOCALID_1';

/**
 * Chips render inside a message, and `MessageByIndexProvider` rebinds the aui
 * context's `composer` to that message's *edit* composer: a no-op while the
 * message isn't being edited, and — once `switchToNewThread` empties the
 * thread — an index lookup that throws. Modelling that here is the point of
 * this mock: with a thread-composer-shaped stub the actions pass while the
 * feature is dead in the app.
 */
const messageScopedComposer = () => {
  throw new Error('useClientLookup: Index 3 out of bounds (length: 0)');
};

/** The live main-thread composer, reachable only through `threads.thread('main').composer()`. */
const threadComposer = { setText, send, append, getState: getComposerState };

vi.mock('@assistant-ui/react', () => ({
  useAui: () => ({
    composer: messageScopedComposer,
    threads: {
      thread: () => ({ composer: () => threadComposer }),
      switchToNewThread,
      switchToThread,
      append,
      getState: () => ({ newThreadId }),
    },
  }),
}));

// ── Draft seams ──────────────────────────────────────────────────────────────
vi.mock('@/features/sessions/new-thread/initialize-draft', () => ({
  initializeDraft: vi.fn(async (args: unknown) => {
    calls.push('initializeDraft');
    return args;
  }),
}));
vi.mock('@/features/sessions/new-thread/reset-new-thread-draft', () => ({
  resetNewThreadDraft: vi.fn((id: string | null) => {
    calls.push(`resetNewThreadDraft:${String(id)}`);
  }),
}));

// ── Context seams ────────────────────────────────────────────────────────────
const ADAPTERS: AdapterInfo[] = [{ id: 'claude', name: 'Claude' } as AdapterInfo];
let chatConfig: { projectId: string; adapterId: string } | null = { projectId: 'proj-7', adapterId: 'codex' };

vi.mock('../../runtime/chat-extras', () => ({
  useChatExtras: () => (chatConfig ? { state: { chatConfig } } : { state: { chatConfig: null } }),
}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
vi.mock('@/store/adapters', () => ({ useAdapters: () => ADAPTERS }));
vi.mock('@/store/settings', () => ({
  useSettingsStore: (selector: (s: unknown) => unknown) => selector({ general: { defaultAdapterId: 'claude' } }),
}));

const toastError = vi.fn();
vi.mock('@/lib/toast', () => ({ mfToast: { error: (...a: unknown[]) => toastError(...a) } }));

import { useInstructionActions } from '../use-instruction-actions';
import { initializeDraft } from '@/features/sessions/new-thread/initialize-draft';
import { resetNewThreadDraft } from '@/features/sessions/new-thread/reset-new-thread-draft';

/** renderHook must run OUTSIDE act(), or `result.current` is still null inside the callback. */
function actions() {
  return renderHook(() => useInstructionActions()).result.current;
}

/** Lets the `void (async () => …)()` body in runInNewSession run to completion. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  // clearAllMocks wipes calls but keeps implementations, so per-test overrides
  // of switchToNewThread/initializeDraft have to be restored by hand.
  vi.clearAllMocks();
  calls.length = 0;
  document.body.innerHTML = '';
  newThreadId = '__LOCALID_1';
  chatConfig = { projectId: 'proj-7', adapterId: 'codex' };
  getComposerState.mockReturnValue({ text: '' });
  switchToNewThread.mockImplementation(async () => {
    calls.push('switchToNewThread');
  });
  vi.mocked(initializeDraft).mockImplementation(async (args) => {
    calls.push('initializeDraft');
    return args as never;
  });
});

describe('append', () => {
  it('appends onto existing composer text on a new line', () => {
    getComposerState.mockReturnValue({ text: 'draft' });
    const a = actions();
    act(() => a.append('/domain-modeling'));
    expect(setText).toHaveBeenCalledWith('draft\n/domain-modeling');
  });

  it('sets the instruction alone when the composer is empty', () => {
    const a = actions();
    act(() => a.append('/domain-modeling'));
    expect(setText).toHaveBeenCalledWith('/domain-modeling');
  });

  it('trims trailing whitespace off the existing text before joining', () => {
    getComposerState.mockReturnValue({ text: 'draft   \n\n' });
    const a = actions();
    act(() => a.append('/domain-modeling'));
    expect(setText).toHaveBeenCalledWith('draft\n/domain-modeling');
  });

  it('writes to the thread composer, never the message-scoped one', () => {
    // The message-scoped composer throws; reaching for it would surface as an
    // unhandled error instead of the prefill.
    const a = actions();
    expect(() => act(() => a.append('/domain-modeling'))).not.toThrow();
    expect(setText).toHaveBeenCalledWith('/domain-modeling');
  });

  it('inserts the whole instruction line including arguments (the code-seam case)', () => {
    getComposerState.mockReturnValue({ text: 'draft' });
    const a = actions();
    act(() => a.append('/todo-pipeline run'));
    expect(setText).toHaveBeenCalledWith('draft\n/todo-pipeline run');
  });

  it('focuses the composer input and never sends or switches threads', () => {
    const input = document.createElement('textarea');
    input.setAttribute('data-mf-composer-input', '');
    document.body.appendChild(input);

    const a = actions();
    act(() => a.append('/domain-modeling'));

    expect(document.activeElement).toBe(input);
    expect(send).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(switchToNewThread).not.toHaveBeenCalled();
    expect(switchToThread).not.toHaveBeenCalled();
  });
});

describe('runInNewSession', () => {
  it('resets the slot, awaits the switch, initializes the draft, then prefills — in that order', async () => {
    const a = actions();
    act(() => a.runInNewSession('/domain-modeling'));
    await flush();

    expect(calls).toEqual([
      'resetNewThreadDraft:__LOCALID_1',
      'switchToNewThread',
      'initializeDraft',
      'setText:/domain-modeling',
    ]);
  });

  it('initializes the draft with the source chat’s project and adapter', async () => {
    const a = actions();
    act(() => a.runInNewSession('/domain-modeling'));
    await flush();

    expect(initializeDraft).toHaveBeenCalledWith({
      localId: '__LOCALID_1',
      projectId: 'proj-7',
      port: 31415,
      defaultAdapterId: 'claude',
      adapters: ADAPTERS,
      adapterId: 'codex',
    });
  });

  it('reads the new thread id AFTER the switch resolves, not before', async () => {
    newThreadId = '__LOCALID_stale';
    switchToNewThread.mockImplementation(async () => {
      calls.push('switchToNewThread');
      newThreadId = '__LOCALID_fresh';
    });

    const a = actions();
    act(() => a.runInNewSession('/domain-modeling'));
    await flush();

    expect(resetNewThreadDraft).toHaveBeenCalledWith('__LOCALID_stale');
    expect(initializeDraft).toHaveBeenCalledWith(expect.objectContaining({ localId: '__LOCALID_fresh' }));
  });

  it('does not prefill while the thread switch is still pending', async () => {
    let resolveSwitch!: () => void;
    switchToNewThread.mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolveSwitch = () => r();
        }),
    );

    const a = actions();
    act(() => a.runInNewSession('/domain-modeling'));
    await flush();

    expect(setText).not.toHaveBeenCalled();
    expect(initializeDraft).not.toHaveBeenCalled();

    await act(async () => {
      resolveSwitch();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setText).toHaveBeenCalledWith('/domain-modeling');
  });

  it('prefills the whole instruction line including arguments', async () => {
    const a = actions();
    act(() => a.runInNewSession('/todo-pipeline run'));
    await flush();
    expect(setText).toHaveBeenCalledWith('/todo-pipeline run');
  });

  it('never sends or appends a message', async () => {
    const a = actions();
    act(() => a.runInNewSession('/domain-modeling'));
    await flush();
    expect(send).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it('no-ops without a source project — no switch, no toast', async () => {
    chatConfig = null;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const a = actions();
    act(() => a.runInNewSession('/domain-modeling'));
    await flush();

    expect(switchToNewThread).not.toHaveBeenCalled();
    expect(setText).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[smart-actions] source chat has no project; cannot start a session');
    warn.mockRestore();
  });

  it('raises an error toast and does not prefill when the draft never materializes', async () => {
    newThreadId = null;
    switchToNewThread.mockImplementation(async () => {
      calls.push('switchToNewThread');
    });

    const a = actions();
    act(() => a.runInNewSession('/domain-modeling'));
    await flush();

    expect(setText).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('Couldn’t start a new session', {
      description: 'No draft session was created',
    });
  });

  it('raises an error toast when initializeDraft rejects', async () => {
    vi.mocked(initializeDraft).mockRejectedValueOnce(new Error('adapter codex is unavailable'));

    const a = actions();
    act(() => a.runInNewSession('/domain-modeling'));
    await flush();

    expect(setText).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('Couldn’t start a new session', {
      description: 'adapter codex is unavailable',
    });
  });
});
