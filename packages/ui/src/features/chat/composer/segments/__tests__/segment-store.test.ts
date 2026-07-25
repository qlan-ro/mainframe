/**
 * useComposerSegments — per-thread segment store (280-A7 store half).
 *
 * In-memory only, keyed by the aui thread item id. No persistence, no
 * daemon-scoped storage — cleared entirely on daemon switch by
 * resetDaemonScopedStores (separate test file).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useComposerSegments, selectComposerSegment } from '../segment-store';

const EMPTY = { committed: [], liveQuote: null };

beforeEach(() => {
  useComposerSegments.setState({ byThread: {} });
});

describe('useComposerSegments — per-thread isolation', () => {
  it("thread A's append does not touch thread B", () => {
    useComposerSegments.getState().append('thread-a', { quote: 'Q1', liveText: '' });

    expect(useComposerSegments.getState().byThread['thread-a']?.liveQuote?.text).toBe('Q1');
    expect(useComposerSegments.getState().byThread['thread-b']).toBeUndefined();
  });
});

describe('useComposerSegments — clear', () => {
  it('empties only its own thread', () => {
    useComposerSegments.getState().append('thread-a', { quote: 'Q1', liveText: '' });
    useComposerSegments.getState().append('thread-b', { quote: 'Q2', liveText: '' });

    useComposerSegments.getState().clear('thread-a');

    expect(useComposerSegments.getState().byThread['thread-a']).toEqual(EMPTY);
    expect(useComposerSegments.getState().byThread['thread-b']?.liveQuote?.text).toBe('Q2');
  });
});

describe('useComposerSegments — read-switch-read cycle', () => {
  it('a composition survives switching away and back to the same thread', () => {
    useComposerSegments.getState().append('thread-a', { quote: 'Q1', liveText: 'intro' });
    const afterAppend = selectComposerSegment('thread-a');

    // Read a different thread in between — must not mutate thread-a.
    selectComposerSegment('thread-b');

    expect(selectComposerSegment('thread-a')).toEqual(afterAppend);
  });
});

describe('useComposerSegments — unknown thread', () => {
  it('returns the empty composition without writing', () => {
    expect(selectComposerSegment('never-seen')).toEqual(EMPTY);
    expect(useComposerSegments.getState().byThread['never-seen']).toBeUndefined();
  });
});

describe('useComposerSegments — dismiss', () => {
  it('delegates to dismissQuote for the addressed thread only', () => {
    useComposerSegments.getState().append('thread-a', { quote: 'Q1', liveText: '' });
    const liveId = useComposerSegments.getState().byThread['thread-a']!.liveQuote!.id;

    useComposerSegments.getState().dismiss('thread-a', liveId);

    expect(useComposerSegments.getState().byThread['thread-a']?.liveQuote).toBeNull();
  });

  it('dismissing on an unknown thread is a no-op (no entry created)', () => {
    useComposerSegments.getState().dismiss('never-seen', 'some-id');
    expect(useComposerSegments.getState().byThread['never-seen']).toBeUndefined();
  });
});
