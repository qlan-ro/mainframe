// @vitest-environment jsdom
/**
 * submit-references — session-reference-specific behavior of
 * useSubmitComposition (todo #240). AC 5-7, 9, 15, 19; edge cases 4-7, 17, 18.
 *
 * The append-shape/reset/attachment mechanics of useSubmitComposition are
 * already pinned in use-submit-composition.test.tsx; this file states only
 * the session-reference outcomes, as fixed inputs with hardcoded expected
 * bodies — never a recomputation of prependSessionReferences/stripReferenceLines.
 * The strip import is only the decode half of the wire round trip.
 *
 * Mocking strategy mirrors use-submit-composition.test.tsx: a fake
 * `useAui`/`useAuiState` pair over `@assistant-ui/react`, with the REAL
 * `useComposerSegments`/`useSessionReferences` stores seeded directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useComposerSegments } from '../../segments/segment-store';
import { stripReferenceLines } from '../../../markers/message-markers';

const THREAD_ID = 'thread-1';

let liveText = '';
const liveAttachments: unknown[] = [];
const liveRunConfig: unknown = { custom: { effort: 'high' } };

const appendSpy = vi.fn();

const runtimeGetState = vi.fn(() => ({
  text: liveText,
  attachments: liveAttachments,
  runConfig: liveRunConfig,
  canSend: false,
}));

vi.mock('@assistant-ui/react', () => ({
  useAui: () => ({
    thread: { append: (...args: unknown[]) => appendSpy(...args) },
    composer: {
      __internal_getRuntime: () => ({ getState: runtimeGetState }),
      getState: runtimeGetState,
      reset: () => Promise.resolve(),
    },
  }),
  useAuiState: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      threadListItem: { id: THREAD_ID },
      composer: { text: liveText, attachments: liveAttachments },
    }),
}));

const resolveSessionTranscriptsSpy = vi.fn();
vi.mock('@/lib/api/session-transcripts', () => ({
  resolveSessionTranscripts: (...args: unknown[]) => resolveSessionTranscriptsSpy(...args),
}));

import { useSubmitComposition } from '../../segments/use-submit-composition';
import { useSessionReferences } from '../session-reference-store';

function appendedText(): string {
  const [callArg] = appendSpy.mock.calls[0] as [{ content: { text: string }[] }];
  return callArg.content[0]!.text;
}

beforeEach(() => {
  vi.clearAllMocks();
  liveText = '';
  liveAttachments.length = 0;
  useComposerSegments.setState({ byThread: {} });
  useSessionReferences.setState({ byThread: {} });
});

describe('submit — one referenced session', () => {
  it('prepends the reference line, whose body carries no chat id and no CLI session id', () => {
    useSessionReferences.getState().record(THREAD_ID, 'Foo refactor', '/tmp/a.jsonl');
    liveText = 'look at @session[Foo refactor]';

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    const text = appendedText();
    expect(text).toBe('Referenced session @session[Foo refactor]: /tmp/a.jsonl\n\nlook at @session[Foo refactor]');
    expect(text).toMatch(/^Referenced session @session\[[^\]\n]*\]: \/.+$/m);
    expect(text).not.toContain('thread-1');
    expect(text).not.toContain('chat-');
  });
});

describe('submit — the draft spelling the picker inserts', () => {
  it('expands a bare @<label> mention into the wire token and its reference line', () => {
    useSessionReferences.getState().record(THREAD_ID, 'Model Identity', '/tmp/a.jsonl');
    liveText = 'look at @Model Identity now';

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    expect(appendedText()).toBe(
      'Referenced session @session[Model Identity]: /tmp/a.jsonl\n\nlook at @session[Model Identity] now',
    );
  });

  it('leaves a bare @token that matches no recorded label as plain text', () => {
    useSessionReferences.getState().record(THREAD_ID, 'Foo', '/tmp/foo.jsonl');
    liveText = 'ask @Somebody else';

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    expect(appendedText()).toBe('ask @Somebody else');
  });
});

describe('submit — duplicate and multiple references', () => {
  it('two tokens with the same label produce exactly one reference line', () => {
    useSessionReferences.getState().record(THREAD_ID, 'Foo', '/tmp/foo.jsonl');
    liveText = '@session[Foo] and again @session[Foo]';

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    expect(appendedText()).toBe(
      'Referenced session @session[Foo]: /tmp/foo.jsonl\n\n@session[Foo] and again @session[Foo]',
    );
  });

  it('two tokens with different labels produce two lines carrying their own paths', () => {
    useSessionReferences.getState().record(THREAD_ID, 'Foo', '/tmp/foo.jsonl');
    useSessionReferences.getState().record(THREAD_ID, 'Bar', '/tmp/bar.jsonl');
    liveText = 'compare @session[Foo] with @session[Bar]';

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    expect(appendedText()).toBe(
      'Referenced session @session[Foo]: /tmp/foo.jsonl\nReferenced session @session[Bar]: /tmp/bar.jsonl' +
        '\n\ncompare @session[Foo] with @session[Bar]',
    );
  });
});

describe('submit — hand-typed, unresolved token', () => {
  it('adds no line and does not throw; append still fires', () => {
    liveText = 'reference @session[Nonexistent] please';

    const { result } = renderHook(() => useSubmitComposition());
    expect(() => act(() => result.current())).not.toThrow();

    expect(appendSpy).toHaveBeenCalledOnce();
    expect(appendedText()).toBe('reference @session[Nonexistent] please');
  });
});

describe('submit — multi-quote composition', () => {
  it('places reference lines above the first `>` block', () => {
    useComposerSegments.getState().append(THREAD_ID, { quote: 'Q1', liveText: '' });
    useSessionReferences.getState().record(THREAD_ID, 'Foo', '/tmp/foo.jsonl');
    liveText = 'see @session[Foo]';

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    expect(appendedText()).toBe('Referenced session @session[Foo]: /tmp/foo.jsonl\n\n> Q1\n\nsee @session[Foo]');
  });
});

describe('submit — slash composition (decision D1)', () => {
  it('keeps a single-line slash command on line 1, reference line after it, and round-trips byte-identically', () => {
    useSessionReferences.getState().record(THREAD_ID, 'Foo', '/p');
    liveText = '/review @session[Foo]';
    const draft = liveText;

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    const text = appendedText();
    expect(text.startsWith('/review')).toBe(true);
    expect(text).toContain('Referenced session @session[Foo]: /p');
    expect(stripReferenceLines(text)).toBe(draft);
  });

  it('keeps a multi-line slash draft intact with no extra blank line before the rest', () => {
    useSessionReferences.getState().record(THREAD_ID, 'Foo', '/p');
    liveText = '/review @session[Foo]\nand this';
    const draft = liveText;

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    const text = appendedText();
    expect(text).toBe('/review @session[Foo]\n\nReferenced session @session[Foo]: /p\nand this');
    expect(text.startsWith('/review')).toBe(true);
    expect(stripReferenceLines(text)).toBe(draft);
  });
});

describe('submit — store cleared, no resolution request', () => {
  it('clears the reference store after a successful send', () => {
    useSessionReferences.getState().record(THREAD_ID, 'Foo', '/tmp/foo.jsonl');
    liveText = 'see @session[Foo]';

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    expect(useSessionReferences.getState().byThread[THREAD_ID]).toEqual({});
  });

  it('never calls resolveSessionTranscripts during submit', () => {
    useSessionReferences.getState().record(THREAD_ID, 'Foo', '/tmp/foo.jsonl');
    liveText = 'see @session[Foo]';

    const { result } = renderHook(() => useSubmitComposition());
    act(() => result.current());

    expect(resolveSessionTranscriptsSpy).not.toHaveBeenCalled();
  });
});
