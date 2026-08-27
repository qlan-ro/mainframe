/**
 * openNewThreadDraft — pure, dependency-injected sequence (spec §2.4 steps 1-5).
 *
 * Every dependency is a fake so the order-sensitive sequence (filter clear →
 * rememberReturn → reset → switch → re-read → initialize → prefill) is pinned
 * without touching zustand stores, assistant-ui, or the daemon. Mirrors the
 * behaviors SessionsNewButton.test.tsx already pins for the picker's `pick()`,
 * plus the new project-filter and prefill behaviors the second call site needs.
 */
import { describe, it, expect, vi } from 'vitest';
import type { AssistantClient } from '@assistant-ui/react';
import { openNewThreadDraft, type OpenNewThreadDraftDeps } from '../open-new-thread-draft';

function makeDeps(overrides: Partial<OpenNewThreadDraftDeps> = {}): OpenNewThreadDraftDeps {
  return {
    filterProjectIds: new Set(),
    clearProjectFilter: vi.fn(),
    runtimeThreads: {
      getState: vi.fn(() => ({ newThreadId: undefined, mainThreadId: null })),
      switchToNewThread: vi.fn(async () => {}),
    },
    setReturnTarget: vi.fn(),
    resetNewThreadDraft: vi.fn(),
    initializeDraft: vi.fn(async () => ({})),
    setText: vi.fn(),
    mfToastError: vi.fn(),
    ...overrides,
  };
}

describe('openNewThreadDraft — project filter clearing', () => {
  it('clears the filter when the scope is set and does not contain the target project', async () => {
    const deps = makeDeps({
      filterProjectIds: new Set(['proj-old']),
      runtimeThreads: {
        getState: vi.fn(() => ({ newThreadId: 'id-1', mainThreadId: null })),
        switchToNewThread: vi.fn(async () => {}),
      },
    });

    await openNewThreadDraft({ projectId: 'proj-new' }, deps);

    expect(deps.clearProjectFilter).toHaveBeenCalledTimes(1);
  });

  it('does not clear the filter when the scope is empty', async () => {
    const deps = makeDeps({ filterProjectIds: new Set() });
    await openNewThreadDraft({ projectId: 'proj-new' }, deps);
    expect(deps.clearProjectFilter).not.toHaveBeenCalled();
  });

  it('does not clear the filter when the scope already contains the target project', async () => {
    const deps = makeDeps({ filterProjectIds: new Set(['proj-new']) });
    await openNewThreadDraft({ projectId: 'proj-new' }, deps);
    expect(deps.clearProjectFilter).not.toHaveBeenCalled();
  });

  it('does not clear the filter when the target project is among several scoped projects', async () => {
    const deps = makeDeps({ filterProjectIds: new Set(['proj-other', 'proj-new']) });
    await openNewThreadDraft({ projectId: 'proj-new' }, deps);
    expect(deps.clearProjectFilter).not.toHaveBeenCalled();
  });

  it('clears the filter when the scope names several projects, none of them the target', async () => {
    const deps = makeDeps({ filterProjectIds: new Set(['proj-other', 'proj-another']) });
    await openNewThreadDraft({ projectId: 'proj-new' }, deps);
    expect(deps.clearProjectFilter).toHaveBeenCalledTimes(1);
  });
});

describe('openNewThreadDraft — rememberReturn timing', () => {
  it('snapshots mainThreadId as it was BEFORE the switch', async () => {
    let switched = false;
    const deps = makeDeps({
      runtimeThreads: {
        getState: vi.fn(() => ({
          newThreadId: switched ? 'id-1' : undefined,
          mainThreadId: switched ? '__LOCALID_1' : 'chat-existing',
        })),
        switchToNewThread: vi.fn(async () => {
          switched = true;
        }),
      },
    });

    await openNewThreadDraft({ projectId: 'proj-a' }, deps);

    expect(deps.setReturnTarget).toHaveBeenCalledWith('chat-existing');
  });
});

describe('openNewThreadDraft — reset + switch + re-read ordering', () => {
  it('resets the pre-switch slot id, then switches, then re-reads newThreadId', async () => {
    const calls: string[] = [];
    let switched = false;
    const deps = makeDeps({
      runtimeThreads: {
        getState: vi.fn(() => {
          calls.push('getState');
          return { newThreadId: switched ? '__LOCALID_2' : '__LOCALID_1', mainThreadId: null };
        }),
        switchToNewThread: vi.fn(async () => {
          calls.push('switchToNewThread');
          switched = true;
        }),
      },
      resetNewThreadDraft: vi.fn((id: string | null | undefined) => {
        calls.push(`reset:${id}`);
      }),
      initializeDraft: vi.fn(async (args: { localId: string }) => {
        calls.push(`initialize:${args.localId}`);
        return {};
      }),
    });

    await openNewThreadDraft({ projectId: 'proj-a' }, deps);

    // Two pre-switch reads: rememberReturn's mainThreadId snapshot, then the
    // slot id resetNewThreadDraft clears — both must land before the switch.
    expect(calls).toEqual([
      'getState',
      'getState',
      'reset:__LOCALID_1',
      'switchToNewThread',
      'getState',
      'initialize:__LOCALID_2',
    ]);
  });

  it('a fake returning undefined before the switch and an id after still initializes the post-switch id', async () => {
    let switched = false;
    const deps = makeDeps({
      runtimeThreads: {
        getState: vi.fn(() => ({ newThreadId: switched ? '__LOCALID_9' : undefined, mainThreadId: null })),
        switchToNewThread: vi.fn(async () => {
          switched = true;
        }),
      },
    });

    await openNewThreadDraft({ projectId: 'proj-a' }, deps);

    expect(deps.initializeDraft).toHaveBeenCalledWith(expect.objectContaining({ localId: '__LOCALID_9' }));
  });
});

describe('openNewThreadDraft — newThreadId still null after the switch', () => {
  it('does not initialize and does not set text', async () => {
    const deps = makeDeps({
      runtimeThreads: {
        getState: vi.fn(() => ({ newThreadId: undefined, mainThreadId: null })),
        switchToNewThread: vi.fn(async () => {}),
      },
    });

    await openNewThreadDraft({ projectId: 'proj-a', prefill: 'hello' }, deps);

    expect(deps.initializeDraft).not.toHaveBeenCalled();
    expect(deps.setText).not.toHaveBeenCalled();
  });
});

describe('openNewThreadDraft — initializeDraft rejects', () => {
  it('surfaces mfToast.error and never calls setText', async () => {
    const deps = makeDeps({
      runtimeThreads: {
        getState: vi.fn(() => ({ newThreadId: '__LOCALID_1', mainThreadId: null })),
        switchToNewThread: vi.fn(async () => {}),
      },
      initializeDraft: vi.fn(async () => {
        throw new Error('boom');
      }),
    });

    await openNewThreadDraft({ projectId: 'proj-a', prefill: 'hello' }, deps);

    expect(deps.mfToastError).toHaveBeenCalledWith('Couldn’t initialize session', { description: 'boom' });
    expect(deps.setText).not.toHaveBeenCalled();
  });
});

describe('openNewThreadDraft — prefill', () => {
  it('sets text exactly once, after initializeDraft resolves, with the raw string', async () => {
    const order: string[] = [];
    const deps = makeDeps({
      runtimeThreads: {
        getState: vi.fn(() => ({ newThreadId: '__LOCALID_1', mainThreadId: null })),
        switchToNewThread: vi.fn(async () => {}),
      },
      initializeDraft: vi.fn(async () => {
        order.push('initializeDraft');
        return {};
      }),
      setText: vi.fn((text: string) => {
        order.push(`setText:${text}`);
      }),
    });

    await openNewThreadDraft({ projectId: 'proj-a', prefill: '> not a marker' }, deps);

    expect(deps.setText).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['initializeDraft', 'setText:> not a marker']);
  });

  it('with prefill omitted, setText is never called', async () => {
    const deps = makeDeps({
      runtimeThreads: {
        getState: vi.fn(() => ({ newThreadId: '__LOCALID_1', mainThreadId: null })),
        switchToNewThread: vi.fn(async () => {}),
      },
    });

    await openNewThreadDraft({ projectId: 'proj-a' }, deps);

    expect(deps.setText).not.toHaveBeenCalled();
  });
});

describe('openNewThreadDraft — the aui `threads` scope', () => {
  // The scope both binding hooks now inject is narrower than the legacy thread
  // list it replaces: `newThreadId` is `string | null`, `mainThreadId` is
  // `string`, and `switchToNewThread()` is declared `void`. This assignment is
  // the guard — `tsc` fails here if the injected type stops accepting it.
  const auiThreads = null as unknown as ReturnType<AssistantClient['threads']>;

  it('is accepted as the injected runtimeThreads', () => {
    expect(makeDeps({ runtimeThreads: auiThreads }).runtimeThreads).toBe(auiThreads);
  });

  it('runs the whole sequence against a scope-shaped fake', async () => {
    const calls: string[] = [];
    let switched = false;
    const deps = makeDeps({
      runtimeThreads: {
        getState: vi.fn((): { newThreadId: string | null; mainThreadId: string } => {
          calls.push('getState');
          return { newThreadId: switched ? '__LOCALID_7' : null, mainThreadId: 'thread-main' };
        }),
        switchToNewThread: vi.fn((): void => {
          calls.push('switchToNewThread');
          switched = true;
        }),
      },
    });

    await openNewThreadDraft({ projectId: 'proj-a', prefill: 'hello' }, deps);

    expect(calls).toEqual(['getState', 'getState', 'switchToNewThread', 'getState']);
    expect(deps.setReturnTarget).toHaveBeenCalledWith('thread-main');
    expect(deps.resetNewThreadDraft).toHaveBeenCalledWith(null);
    expect(deps.initializeDraft).toHaveBeenCalledWith({ localId: '__LOCALID_7', projectId: 'proj-a' });
    expect(deps.setText).toHaveBeenCalledWith('hello');
  });
});
