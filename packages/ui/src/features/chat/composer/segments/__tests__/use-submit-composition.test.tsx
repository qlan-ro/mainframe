import { THREAD_ID, appendSpy, resetSpy, callOrder, live } from './submit-composition-fixture';
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSubmitComposition, useCanSubmit } from '../use-submit-composition';
import { useComposerSegments } from '../segment-store';

describe('useSubmitComposition — append shape', () => {
  it('appends once with the serialized composition, resolved attachments, and live runConfig', () => {
    useComposerSegments.getState().append(THREAD_ID, { quote: 'Q1', liveText: '' });
    live.text = 'hello there';
    live.attachments = [
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
      metadata: { custom: { mainframeSubmittedDraft: expect.any(String) } },
    });
  });
});

describe('useSubmitComposition — runConfig/attachments are read before reset()', () => {
  it('the appended runConfig is the PRE-reset value, not the post-reset null', () => {
    live.text = 'draft text';
    const preResetRunConfig = live.runConfig;

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    const [callArg] = appendSpy.mock.calls[0] as [{ runConfig: unknown }];
    expect(callArg.runConfig).toBe(preResetRunConfig);
    expect(callArg.runConfig).not.toBeNull();
  });

  it('the appended attachments are resolved from the PRE-reset value, not the post-reset empty array', () => {
    live.text = 'draft text';
    live.attachments = [
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
    live.text = 'draft text';

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    expect(callOrder).toEqual(['append', 'reset']);
    expect(resetSpy).toHaveBeenCalledOnce();
  });

  it("clears the addressed thread's segment store synchronously", () => {
    useComposerSegments.getState().append(THREAD_ID, { quote: 'Q1', liveText: '' });
    live.text = 'draft text';

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
    live.attachments = [
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
      metadata: { custom: { mainframeSubmittedDraft: expect.any(String) } },
    });
  });
});

describe('useCanSubmit — the send button gate, split out of useSubmitComposition', () => {
  it('is false with an empty composer and no segments', () => {
    const { result } = renderHook(() => useCanSubmit());
    expect(result.current).toBe(false);
  });

  it('is true on live text alone', () => {
    live.text = 'typed';
    const { result } = renderHook(() => useCanSubmit());
    expect(result.current).toBe(true);
  });

  it('is true on a committed segment alone, with the live input empty', () => {
    useComposerSegments.getState().append(THREAD_ID, { quote: 'Q1', liveText: 'prose' });
    const { result } = renderHook(() => useCanSubmit());
    expect(result.current).toBe(true);
  });

  it('is true on attachments alone', () => {
    live.attachments = [{ id: 'att-only', type: 'image', name: 'shot.png', contentType: 'image/png', content: [] }];
    const { result } = renderHook(() => useCanSubmit());
    expect(result.current).toBe(true);
  });

  it('ignores canSend', () => {
    live.canSend = true;
    const { result } = renderHook(() => useCanSubmit());
    expect(result.current).toBe(false);
  });
});

describe('useSubmitComposition — predicate never reads canSend', () => {
  it('submits on non-empty serialization even though canSend is false', () => {
    live.text = 'typed without canSend';
    live.canSend = false;

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    expect(appendSpy).toHaveBeenCalledOnce();
  });

  it('does not submit on empty serialization + no attachments even though canSend is true', () => {
    live.canSend = true;

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
