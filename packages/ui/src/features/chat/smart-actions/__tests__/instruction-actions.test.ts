// @vitest-environment jsdom
/**
 * useInstructionActions — behavior tests for the two chip actions (AC #278.3, #278.4, #278.7).
 *
 * `append` is prefill-only and asserted directly against the thread composer.
 * `runInNewSession` now delegates its whole order-sensitive sequence (reset →
 * switch → wait → initialize → prefill, #359) to the shared
 * `useOpenNewThreadDraft` hook — that sequence is pinned in
 * `open-new-thread-draft.test.ts`. Here we only assert the chip calls it with
 * the source chat's projectId/adapterId/prefill, and the no-project no-op.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── assistant-ui seams ───────────────────────────────────────────────────────
const setText = vi.fn();
const send = vi.fn();
const append = vi.fn();
const getComposerState = vi.fn(() => ({ text: '' }));

/**
 * Chips render inside a message, and `MessageByIndexProvider` rebinds the aui
 * context's `composer` to that message's *edit* composer: a no-op while the
 * message isn't being edited, and — once the thread switches away — an index
 * lookup that throws. Modelling that here is the point of this mock: with a
 * thread-composer-shaped stub `append` passes while the feature is dead in
 * the app.
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
    },
  }),
}));

// ── Shared draft-open sequence seam ──────────────────────────────────────────
const openNewThreadDraftSpy = vi.fn();
vi.mock('@/features/sessions/new-thread/use-open-new-thread-draft', () => ({
  useOpenNewThreadDraft: () => openNewThreadDraftSpy,
}));

// ── Context seams ────────────────────────────────────────────────────────────
let chatConfig: { projectId: string; adapterId: string } | null = { projectId: 'proj-7', adapterId: 'codex' };

vi.mock('../../runtime/chat-extras', () => ({
  useChatExtras: () => (chatConfig ? { state: { chatConfig } } : { state: { chatConfig: null } }),
}));

import { useInstructionActions } from '../use-instruction-actions';

/** renderHook must run OUTSIDE act(), or `result.current` is still null inside the callback. */
function actions() {
  return renderHook(() => useInstructionActions()).result.current;
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  chatConfig = { projectId: 'proj-7', adapterId: 'codex' };
  getComposerState.mockReturnValue({ text: '' });
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

  it('focuses the composer input and never sends or opens a new session', () => {
    const input = document.createElement('textarea');
    input.setAttribute('data-mf-composer-input', '');
    document.body.appendChild(input);

    const a = actions();
    act(() => a.append('/domain-modeling'));

    expect(document.activeElement).toBe(input);
    expect(send).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(openNewThreadDraftSpy).not.toHaveBeenCalled();
  });
});

describe('runInNewSession', () => {
  it('opens a draft with the source chat’s project, adapter and the instruction as prefill', () => {
    const a = actions();
    act(() => a.runInNewSession('/domain-modeling'));

    expect(openNewThreadDraftSpy).toHaveBeenCalledExactlyOnceWith({
      projectId: 'proj-7',
      adapterId: 'codex',
      prefill: '/domain-modeling',
    });
  });

  it('prefills the whole instruction line including arguments', () => {
    const a = actions();
    act(() => a.runInNewSession('/todo-pipeline run'));

    expect(openNewThreadDraftSpy).toHaveBeenCalledExactlyOnceWith({
      projectId: 'proj-7',
      adapterId: 'codex',
      prefill: '/todo-pipeline run',
    });
  });

  it('never sends or appends a message', () => {
    const a = actions();
    act(() => a.runInNewSession('/domain-modeling'));

    expect(send).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it('no-ops without a source project — never opens a draft', () => {
    chatConfig = null;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const a = actions();
    act(() => a.runInNewSession('/domain-modeling'));

    expect(openNewThreadDraftSpy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith('[smart-actions] source chat has no project; cannot start a session');
    warn.mockRestore();
  });
});
