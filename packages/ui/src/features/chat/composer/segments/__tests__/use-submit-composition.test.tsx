/**
 * useSubmitComposition — the one submit path shared by all three composer
 * entry points (spec §2.3, 280-A6/A7). What we verify:
 *
 *  - append fires exactly once with the serialized composition + the LIVE
 *    attachments (resolved to `CompleteAttachment`, mirroring what native
 *    `composer.send()` would have produced via the attachment adapter) and
 *    runConfig, wrapped in the shape `aui.thread().append` expects;
 *  - runConfig/attachments are read BEFORE `composer.reset()` runs — reset()
 *    clears the composer's entire state including runConfig, so reading it
 *    after would silently drop a per-send run config (spec Risks #1). Pinned
 *    with a fake whose `reset()` nulls the live runConfig cell; the asserted
 *    append argument must still be the pre-reset object;
 *  - reset() and segmentStore.clear(threadId) both run, synchronously, right
 *    after append — submit() never awaits reset()'s promise first;
 *  - empty serialization + no attachments → complete no-op (no append, no
 *    reset, no clear);
 *  - empty serialization + attachments → append still fires (parity with
 *    parseSendInput's attachment-only sends);
 *  - the predicate is "non-empty serialization OR attachments" — never
 *    `composer.getState().canSend`, which this suite pins by setting canSend
 *    to a value that would give the wrong answer if it were consulted.
 *
 * `useSubmitComposition` returns the submit function itself and subscribes to
 * nothing: the same predicate is exposed separately as `useCanSubmit`, which
 * DOES subscribe to the live draft and is consumed only inside the send button
 * (hoisting it re-renders the whole composer on every keystroke).
 *
 * Mocking strategy
 * ----------------
 * `@assistant-ui/react` is stubbed with a fake `useAui`/`useAuiState` pair,
 * following the precedent in `ChatSelectionToolbar.test.tsx`: `composer()`
 * exposes `__internal_getRuntime().getState()` (the live, non-stale read —
 * see `use-append-quote-segment.ts`) alongside the plain `getState()`, and
 * `thread()` exposes an `append` spy. The segment store itself is the REAL
 * `useComposerSegments` (seeded directly), not mocked — its own pure
 * transitions are already pinned by segment-model.test.ts/segment-store.test.ts;
 * this file only needs to pin the submit wiring.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useComposerSegments } from '../segment-store';

const THREAD_ID = 'thread-1';

let liveText = '';
let liveAttachments: unknown[] = [];
let liveRunConfig: unknown = { custom: { effort: 'high' } };
let liveCanSend = false;

const appendSpy = vi.fn();
const resetSpy = vi.fn();
const callOrder: string[] = [];

const runtimeGetState = vi.fn(() => ({
  text: liveText,
  attachments: liveAttachments,
  runConfig: liveRunConfig,
  canSend: liveCanSend,
}));

vi.mock('@assistant-ui/react', () => ({
  useAui: () => ({
    thread: () => ({
      append: (...args: unknown[]) => {
        callOrder.push('append');
        appendSpy(...args);
      },
    }),
    composer: () => ({
      __internal_getRuntime: () => ({ getState: runtimeGetState }),
      getState: runtimeGetState,
      reset: () => {
        callOrder.push('reset');
        resetSpy();
        // Mirrors the real ComposerRuntime: reset() clears the composer's
        // entire state, including runConfig, for any FUTURE read.
        liveRunConfig = null;
        liveAttachments = [];
        liveText = '';
        return Promise.resolve();
      },
    }),
  }),
  useAuiState: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      threadListItem: { id: THREAD_ID },
      composer: { text: liveText, attachments: liveAttachments },
    }),
}));

import { useSubmitComposition, useCanSubmit } from '../use-submit-composition';
import { useSessionReferences } from '../../sessions/session-reference-store';

beforeEach(() => {
  vi.clearAllMocks();
  callOrder.length = 0;
  liveText = '';
  liveAttachments = [];
  liveRunConfig = { custom: { effort: 'high' } };
  liveCanSend = false;
  useComposerSegments.setState({ byThread: {} });
  useSessionReferences.setState({ byThread: {} });
});

describe('useSubmitComposition — append shape', () => {
  it('appends once with the serialized composition, resolved attachments, and live runConfig', () => {
    useComposerSegments.getState().append(THREAD_ID, { quote: 'Q1', liveText: '' });
    liveText = 'hello there';
    liveAttachments = [
      {
        id: 'att-1',
        type: 'document',
        name: 'notes.txt',
        contentType: 'text/plain',
        content: [{ type: 'text', text: 'data:text/plain;base64,aGk=' }],
        status: { type: 'requires-action', reason: 'composer-send' },
      },
    ];

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    expect(appendSpy).toHaveBeenCalledExactlyOnceWith({
      role: 'user',
      content: [{ type: 'text', text: '> Q1\n\nhello there' }],
      attachments: [
        {
          id: 'att-1',
          type: 'document',
          name: 'notes.txt',
          contentType: 'text/plain',
          content: [{ type: 'text', text: 'data:text/plain;base64,aGk=' }],
          status: { type: 'complete' },
        },
      ],
      runConfig: { custom: { effort: 'high' } },
    });
  });
});

describe('useSubmitComposition — runConfig/attachments are read before reset()', () => {
  it('the appended runConfig is the PRE-reset value, not the post-reset null', () => {
    liveText = 'draft text';
    const preResetRunConfig = liveRunConfig;

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    const [callArg] = appendSpy.mock.calls[0] as [{ runConfig: unknown }];
    expect(callArg.runConfig).toBe(preResetRunConfig);
    expect(callArg.runConfig).not.toBeNull();
  });

  it('the appended attachments are resolved from the PRE-reset value, not the post-reset empty array', () => {
    liveText = 'draft text';
    liveAttachments = [
      {
        id: 'att-keep',
        type: 'document',
        name: 'keep.txt',
        contentType: 'text/plain',
        content: [],
        status: { type: 'requires-action', reason: 'composer-send' },
      },
    ];

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    const [callArg] = appendSpy.mock.calls[0] as [{ attachments: unknown }];
    expect(callArg.attachments).toEqual([
      {
        id: 'att-keep',
        type: 'document',
        name: 'keep.txt',
        contentType: 'text/plain',
        content: [],
        status: { type: 'complete' },
      },
    ]);
  });
});

describe('useSubmitComposition — reset() and clear() run synchronously right after append', () => {
  it('calls append, then reset, in that order, without awaiting', () => {
    liveText = 'draft text';

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    expect(callOrder).toEqual(['append', 'reset']);
    expect(resetSpy).toHaveBeenCalledOnce();
  });

  it("clears the addressed thread's segment store synchronously", () => {
    useComposerSegments.getState().append(THREAD_ID, { quote: 'Q1', liveText: '' });
    liveText = 'draft text';

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    expect(useComposerSegments.getState().byThread[THREAD_ID]).toEqual({ committed: [], liveQuote: null });
  });
});

describe('useSubmitComposition — empty serialization, no attachments: complete no-op', () => {
  it('does not append, reset, or clear', () => {
    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    expect(appendSpy).not.toHaveBeenCalled();
    expect(resetSpy).not.toHaveBeenCalled();
    expect(useComposerSegments.getState().byThread[THREAD_ID]).toBeUndefined();
  });
});

describe('useSubmitComposition — empty serialization with attachments: append still fires', () => {
  it('appends with an empty text part when only resolved attachments are present', () => {
    liveAttachments = [
      {
        id: 'att-only',
        type: 'image',
        name: 'shot.png',
        contentType: 'image/png',
        content: [{ type: 'image', image: 'data:image/png;base64,aGk=' }],
        status: { type: 'requires-action', reason: 'composer-send' },
      },
    ];

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    expect(appendSpy).toHaveBeenCalledExactlyOnceWith({
      role: 'user',
      content: [{ type: 'text', text: '' }],
      attachments: [
        {
          id: 'att-only',
          type: 'image',
          name: 'shot.png',
          contentType: 'image/png',
          content: [{ type: 'image', image: 'data:image/png;base64,aGk=' }],
          status: { type: 'complete' },
        },
      ],
      runConfig: { custom: { effort: 'high' } },
    });
  });
});

describe('useCanSubmit — the send button gate, split out of useSubmitComposition', () => {
  it('is false with an empty composer and no segments', () => {
    const { result } = renderHook(() => useCanSubmit());
    expect(result.current).toBe(false);
  });

  it('is true on live text alone', () => {
    liveText = 'typed';
    const { result } = renderHook(() => useCanSubmit());
    expect(result.current).toBe(true);
  });

  it('is true on a committed segment alone, with the live input empty', () => {
    useComposerSegments.getState().append(THREAD_ID, { quote: 'Q1', liveText: 'prose' });
    const { result } = renderHook(() => useCanSubmit());
    expect(result.current).toBe(true);
  });

  it('is true on attachments alone', () => {
    liveAttachments = [{ id: 'att-only', type: 'image', name: 'shot.png', contentType: 'image/png', content: [] }];
    const { result } = renderHook(() => useCanSubmit());
    expect(result.current).toBe(true);
  });

  it('ignores canSend', () => {
    liveCanSend = true;
    const { result } = renderHook(() => useCanSubmit());
    expect(result.current).toBe(false);
  });
});

describe('useSubmitComposition — predicate never reads canSend', () => {
  it('submits on non-empty serialization even though canSend is false', () => {
    liveText = 'typed without canSend';
    liveCanSend = false;

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    expect(appendSpy).toHaveBeenCalledOnce();
  });

  it('does not submit on empty serialization + no attachments even though canSend is true', () => {
    liveCanSend = true;

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    expect(appendSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Session references (#240) — the body that reaches the daemon is also the body
// the optimistic echo renders, so the reference lines are prepended ONCE, here,
// before append. Only labels the draft actually still mentions survive.
// ---------------------------------------------------------------------------

describe('useSubmitComposition — session reference lines', () => {
  it('prepends one reference line per referenced label and clears the store', () => {
    useSessionReferences.getState().record(THREAD_ID, 'Foo refactor', '/tmp/a.jsonl');
    liveText = 'compare with @session[Foo refactor] please';

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    const [callArg] = appendSpy.mock.calls[0] as [{ content: { text: string }[] }];
    expect(callArg.content[0]!.text).toBe(
      'Referenced session @session[Foo refactor]: /tmp/a.jsonl\n\ncompare with @session[Foo refactor] please',
    );
    expect(useSessionReferences.getState().byThread[THREAD_ID]).toEqual({});
  });

  it('drops a recorded reference whose token the user deleted from the draft', () => {
    useSessionReferences.getState().record(THREAD_ID, 'Foo refactor', '/tmp/a.jsonl');
    liveText = 'never mind';

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    const [callArg] = appendSpy.mock.calls[0] as [{ content: { text: string }[] }];
    expect(callArg.content[0]!.text).toBe('never mind');
  });

  it('does not send on a draft that is nothing but a stale reference record', () => {
    useSessionReferences.getState().record(THREAD_ID, 'Foo refactor', '/tmp/a.jsonl');

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    expect(appendSpy).not.toHaveBeenCalled();
  });
});
