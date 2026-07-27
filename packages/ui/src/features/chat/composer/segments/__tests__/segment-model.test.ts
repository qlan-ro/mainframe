/**
 * Pure vectors for the segment-model transitions (280-A10).
 *
 * Composition shape: `committed` = s0..s(N-1), each with its own quote and
 * prose; `liveQuote` = the pending quote for the live (native composer) box,
 * whose prose is never stored here — it lives only in the native input.
 */
import { describe, it, expect } from 'vitest';
import { appendQuote, dismissQuote, mintSegmentId, type Composition } from '../segment-model';

const EMPTY: Composition = { committed: [], liveQuote: null };

describe('appendQuote', () => {
  it('onto an empty composition with blank live text: no committed segment, one liveQuote', () => {
    const next = appendQuote(EMPTY, { quote: 'Q1', liveText: '' });
    expect(next.committed).toEqual([]);
    expect(next.liveQuote).not.toBeNull();
    expect(next.liveQuote!.text).toBe('Q1');
  });

  it('with live text present: commits the live text as a quoteless segment, mints a new liveQuote', () => {
    const next = appendQuote(EMPTY, { quote: 'Q1', liveText: 'intro' });
    expect(next.committed).toEqual([{ id: expect.any(String), quote: null, text: 'intro' }]);
    expect(next.liveQuote!.text).toBe('Q1');
  });

  it('a second append commits the previous liveQuote + its typed prose as one segment, in order', () => {
    const first = appendQuote(EMPTY, { quote: 'Q1', liveText: '' });
    const second = appendQuote(first, { quote: 'Q2', liveText: 'first comment' });

    expect(second.committed).toHaveLength(1);
    expect(second.committed[0]).toEqual({
      id: first.liveQuote!.id,
      quote: 'Q1',
      text: 'first comment',
    });
    expect(second.liveQuote!.text).toBe('Q2');
  });
});

describe('dismissQuote', () => {
  it('dismissing the live quote clears it and leaves committed untouched', () => {
    const withLive = appendQuote(EMPTY, { quote: 'Q1', liveText: 'intro' });
    const next = dismissQuote(withLive, withLive.liveQuote!.id);
    expect(next.liveQuote).toBeNull();
    expect(next.committed).toEqual(withLive.committed);
  });

  it('dismissing a committed segment with prose keeps it, prose intact, order unchanged', () => {
    const withCommitted = appendQuote(EMPTY, { quote: 'Q1', liveText: 'intro' });
    const [committed] = withCommitted.committed;
    expect(committed).toBeDefined();

    const next = dismissQuote(withCommitted, committed!.id);
    expect(next.committed).toEqual([{ id: committed!.id, quote: null, text: 'intro' }]);
  });

  it('dismissing a committed segment whose prose is whitespace-only removes it', () => {
    // shouldCommit is driven by liveQuote != null, not by the text's own
    // emptiness — so a pending quote from the first append is required to
    // land a whitespace-only committed segment via the second append.
    const first = appendQuote(EMPTY, { quote: 'Q1', liveText: '' });
    const withCommitted = appendQuote(first, { quote: 'Q2', liveText: '   ' });
    const [committed] = withCommitted.committed;
    expect(committed).toBeDefined();

    const next = dismissQuote(withCommitted, committed!.id);
    expect(next.committed).toEqual([]);
  });
});

describe('mintSegmentId', () => {
  it('mints unique ids', () => {
    const ids = new Set(Array.from({ length: 20 }, () => mintSegmentId()));
    expect(ids.size).toBe(20);
  });

  it('removing a segment does not renumber the others', () => {
    const s1 = appendQuote(EMPTY, { quote: 'Q1', liveText: '' });
    const s2 = appendQuote(s1, { quote: 'Q2', liveText: '  ' });
    const s3 = appendQuote(s2, { quote: 'Q3', liveText: 'b' });

    expect(s3.committed).toHaveLength(2);
    const [first, second] = s3.committed;
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    // Removing the whitespace-only first segment must not shift or
    // regenerate the surviving segment's id.
    const afterDismiss = dismissQuote(s3, first!.id);
    expect(afterDismiss.committed).toEqual([second]);
  });
});
