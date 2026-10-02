/**
 * ResumeCursorTracker — pure unit tests (todo #377, G3 step 1).
 */
import { describe, expect, it } from 'vitest';
import type { MainframeCapabilities } from '@qlan-ro/mainframe-types';
import { ResumeCursorTracker } from '../acp-resume-cursor';

const BOTH: MainframeCapabilities = { revisionCursors: true, replayComplete: true };
const ONLY_REPLAY_COMPLETE: MainframeCapabilities = { replayComplete: true };
const LEGACY: MainframeCapabilities = {};

describe('ResumeCursorTracker.nextReplayFrom — selection matrix', () => {
  it('a fresh tracker with no capability info picks start', () => {
    const tracker = new ResumeCursorTracker();
    expect(tracker.nextReplayFrom(null)).toEqual({ type: 'start' });
    expect(tracker.nextReplayFrom(LEGACY)).toEqual({ type: 'start' });
  });

  it('a settled item on a legacy (no revisionCursors) daemon picks item', () => {
    const tracker = new ResumeCursorTracker();
    tracker.recordSettledItem('m1');
    expect(tracker.nextReplayFrom(LEGACY)).toEqual({ type: 'item', itemId: 'm1' });
    expect(tracker.nextReplayFrom(ONLY_REPLAY_COMPLETE)).toEqual({ type: 'item', itemId: 'm1' });
  });

  it('a durable cursor on a both-capable daemon picks revision over the legacy item cursor', () => {
    const tracker = new ResumeCursorTracker();
    tracker.recordSettledItem('m1');
    tracker.commitReplyCursor({ epoch: 'e1', revision: 3 });
    expect(tracker.nextReplayFrom(BOTH)).toEqual({ type: 'revision', epoch: 'e1', revision: 3 });
  });

  it('revisionCursors alone (no replayComplete) still falls back to the item cursor', () => {
    const tracker = new ResumeCursorTracker();
    tracker.recordSettledItem('m1');
    tracker.commitReplyCursor({ epoch: 'e1', revision: 3 });
    expect(tracker.nextReplayFrom({ revisionCursors: true })).toEqual({ type: 'item', itemId: 'm1' });
  });

  it('both capabilities but no durable cursor yet falls back to the item cursor, then start', () => {
    const tracker = new ResumeCursorTracker();
    tracker.recordSettledItem('m1');
    expect(tracker.nextReplayFrom(BOTH)).toEqual({ type: 'item', itemId: 'm1' });
    const empty = new ResumeCursorTracker();
    expect(empty.nextReplayFrom(BOTH)).toEqual({ type: 'start' });
  });
});

describe('ResumeCursorTracker.commitReplyCursor', () => {
  it('a null/undefined reply cursor is a no-op — an interrupted replay never advances', () => {
    const tracker = new ResumeCursorTracker();
    tracker.commitReplyCursor({ epoch: 'e1', revision: 1 });
    tracker.commitReplyCursor(null);
    tracker.commitReplyCursor(undefined);
    expect(tracker.getDurableCursor()).toEqual({ epoch: 'e1', revision: 1 });
  });

  it('a later commit replaces the durable cursor outright, including across an epoch change', () => {
    const tracker = new ResumeCursorTracker();
    tracker.commitReplyCursor({ epoch: 'e1', revision: 5 });
    tracker.commitReplyCursor({ epoch: 'e2', revision: 0 });
    expect(tracker.getDurableCursor()).toEqual({ epoch: 'e2', revision: 0 });
  });
});

describe('ResumeCursorTracker.clearDurableCursor', () => {
  it('drops the durable cursor so nextReplayFrom falls back to the legacy item cursor', () => {
    const tracker = new ResumeCursorTracker();
    tracker.recordSettledItem('m1');
    tracker.commitReplyCursor({ epoch: 'e1', revision: 1 });
    tracker.clearDurableCursor();
    expect(tracker.getDurableCursor()).toBeNull();
    expect(tracker.nextReplayFrom(BOTH)).toEqual({ type: 'item', itemId: 'm1' });
  });
});

describe('ResumeCursorTracker.advanceFromNotification', () => {
  it('advances within the same epoch when the revision is higher', () => {
    const tracker = new ResumeCursorTracker();
    tracker.commitReplyCursor({ epoch: 'e1', revision: 1 });
    tracker.advanceFromNotification({ epoch: 'e1', revision: 4 });
    expect(tracker.getDurableCursor()).toEqual({ epoch: 'e1', revision: 4 });
  });

  it('ignores a same-or-lower revision within the same epoch', () => {
    const tracker = new ResumeCursorTracker();
    tracker.commitReplyCursor({ epoch: 'e1', revision: 4 });
    tracker.advanceFromNotification({ epoch: 'e1', revision: 4 });
    tracker.advanceFromNotification({ epoch: 'e1', revision: 2 });
    expect(tracker.getDurableCursor()).toEqual({ epoch: 'e1', revision: 4 });
  });

  it('clears the cursor outright on an epoch change rather than adopting it', () => {
    const tracker = new ResumeCursorTracker();
    tracker.commitReplyCursor({ epoch: 'e1', revision: 4 });
    tracker.advanceFromNotification({ epoch: 'e2', revision: 0 });
    expect(tracker.getDurableCursor()).toBeNull();
  });

  it('is a no-op while no durable cursor is established yet', () => {
    const tracker = new ResumeCursorTracker();
    tracker.advanceFromNotification({ epoch: 'e1', revision: 1 });
    expect(tracker.getDurableCursor()).toBeNull();
  });
});
