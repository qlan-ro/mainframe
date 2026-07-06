/**
 * new-thread-ready-store — the reactive signal that flips a new-thread surface
 * from the config picker to the real composer once project+adapter are chosen.
 *
 * The draft-config Map is NOT reactive, so the picker writes the draft AND marks
 * the local id ready here; ChatSurface subscribes and switches picker→ChatThread.
 *
 * Covered:
 *  1. isReady(id) is false before markReady.
 *  2. markReady(id) makes isReady(id) true (and only that id).
 *  3. clearReady(id) makes isReady(id) false again.
 *  4. markReady is idempotent — the readyIds reference is stable on a re-mark
 *     (so React subscribers don't churn).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useNewThreadReady } from '../new-thread-ready-store';

beforeEach(() => {
  // Reset the shared store between tests.
  useNewThreadReady.getState().clearReady('__LOCALID_a');
  useNewThreadReady.getState().clearReady('__LOCALID_b');
});

describe('new-thread-ready-store', () => {
  it('isReady is false before markReady', () => {
    expect(useNewThreadReady.getState().isReady('__LOCALID_a')).toBe(false);
  });

  it('markReady flips isReady to true for that id only', () => {
    useNewThreadReady.getState().markReady('__LOCALID_a');

    expect(useNewThreadReady.getState().isReady('__LOCALID_a')).toBe(true);
    expect(useNewThreadReady.getState().isReady('__LOCALID_b')).toBe(false);
  });

  it('clearReady flips isReady back to false', () => {
    useNewThreadReady.getState().markReady('__LOCALID_a');
    useNewThreadReady.getState().clearReady('__LOCALID_a');

    expect(useNewThreadReady.getState().isReady('__LOCALID_a')).toBe(false);
  });

  it('markReady on an already-ready id keeps the readyIds reference stable', () => {
    useNewThreadReady.getState().markReady('__LOCALID_a');
    const first = useNewThreadReady.getState().readyIds;

    useNewThreadReady.getState().markReady('__LOCALID_a');
    const second = useNewThreadReady.getState().readyIds;

    expect(second).toBe(first);
  });
});
