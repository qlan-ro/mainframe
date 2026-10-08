/**
 * draft-stash — pure module tests (#178 AC14: the draft survives a release).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { markForStash, captureIfMarked, takeStash, seedDraft, handoffDraft } from '../draft-stash';

function file(name: string): File {
  return new File(['x'], name);
}

describe('draft-stash', () => {
  it('captures a marked chat and returns it exactly once', () => {
    markForStash('chat-1');
    captureIfMarked('chat-1', { text: 'hello', attachments: [] });

    expect(takeStash('chat-1')).toEqual({ text: 'hello', attachments: [] });
    expect(takeStash('chat-1')).toBeUndefined();
  });

  it('ignores a capture for an id that was never marked', () => {
    captureIfMarked('chat-2', { text: 'unmarked', attachments: [] });

    expect(takeStash('chat-2')).toBeUndefined();
  });

  it('consumes the mark on capture, so a later unrelated unmount does not also stash', () => {
    markForStash('chat-3');
    captureIfMarked('chat-3', { text: 'first', attachments: [] });
    captureIfMarked('chat-3', { text: 'second (unmarked)', attachments: [] });

    expect(takeStash('chat-3')).toEqual({ text: 'first', attachments: [] });
  });

  it('preserves attachments alongside the text', () => {
    const f = file('a.png');
    markForStash('chat-4');
    captureIfMarked('chat-4', { text: '', attachments: [f] });

    expect(takeStash('chat-4')).toEqual({ text: '', attachments: [f] });
  });

  it('takeStash for an id with no stash returns undefined', () => {
    expect(takeStash('never-stashed')).toBeUndefined();
  });

  it('marking twice before a capture still only stashes once', () => {
    markForStash('chat-5');
    markForStash('chat-5');
    captureIfMarked('chat-5', { text: 'once', attachments: [] });

    expect(takeStash('chat-5')).toEqual({ text: 'once', attachments: [] });
    expect(takeStash('chat-5')).toBeUndefined();
  });

  it('keeps separate chats independent', () => {
    markForStash('chat-a');
    markForStash('chat-b');
    captureIfMarked('chat-a', { text: 'a', attachments: [] });
    captureIfMarked('chat-b', { text: 'b', attachments: [] });

    expect(takeStash('chat-a')).toEqual({ text: 'a', attachments: [] });
    expect(takeStash('chat-b')).toEqual({ text: 'b', attachments: [] });
  });
});

// Isolate a run that asserts no cross-test residue from the module's module-level Maps.
describe('draft-stash — no leakage across unrelated ids', () => {
  beforeEach(() => {
    // No reset export by design (module-level state mirrors the registry's own
    // singleton pattern) — use fresh ids per test instead.
  });

  it('an id that was marked and then released elsewhere without a capture stays pending harmlessly', () => {
    markForStash('chat-6');
    // No capture call — simulates a mark whose unmount effect never ran
    // (e.g. StrictMode double-invoke). A later capture for the SAME id still stashes once.
    captureIfMarked('chat-6', { text: 'late', attachments: [] });
    expect(takeStash('chat-6')).toEqual({ text: 'late', attachments: [] });
  });
});

describe('draft-stash — captureIfMarked cannot clobber a handed-off draft (chat-switch regression)', () => {
  it('ignores an empty capture when a non-empty stash already landed for this id', () => {
    markForStash('chat-race-1');
    // A handoff (another instance giving up displayed status) lands a real
    // draft for this SAME id BEFORE the mark's own (now-empty) capture fires.
    handoffDraft('chat-race-1', { text: 'handed-off draft', attachments: [] });
    captureIfMarked('chat-race-1', { text: '', attachments: [] });

    expect(takeStash('chat-race-1')).toEqual({ text: 'handed-off draft', attachments: [] });
  });

  it('still records an empty capture when there is nothing non-empty to protect', () => {
    markForStash('chat-race-2');
    captureIfMarked('chat-race-2', { text: '', attachments: [] });

    expect(takeStash('chat-race-2')).toEqual({ text: '', attachments: [] });
  });

  it('a genuinely non-empty capture still overwrites (not a blanket no-op)', () => {
    markForStash('chat-race-3');
    handoffDraft('chat-race-3', { text: 'stale', attachments: [] });
    captureIfMarked('chat-race-3', { text: 'fresher at unmount', attachments: [] });

    expect(takeStash('chat-race-3')).toEqual({ text: 'fresher at unmount', attachments: [] });
  });
});

describe('draft-stash — seedDraft (fork-from-message prefill)', () => {
  it('a seeded draft is taken exactly once, with no attachments', () => {
    seedDraft('chat-fork-1', 'try this another way');

    expect(takeStash('chat-fork-1')).toEqual({ text: 'try this another way', attachments: [] });
    expect(takeStash('chat-fork-1')).toBeUndefined();
  });
});
