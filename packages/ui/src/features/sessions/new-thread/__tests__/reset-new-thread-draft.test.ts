/**
 * resetNewThreadDraft — clears the stale draft-config + ready flag for a reused
 * new-thread slot, so an abandoned draft can't leak its project into the next New.
 *
 * Regression: assistant-ui reuses the SAME `__LOCALID_*` newThreadId until a
 * message is sent. The coordinator only clears the draft/ready on a successful
 * first send; abandoning a new-thread draft (switching sessions / changing the
 * filter pill) leaves them behind, and the next New reuses the id — so the guard
 * `getDraftConfig(localId)` (auto-config) and `!isReady` (ChatSurface picker gate)
 * both short-circuit and the chat is created in the stale project.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getDraftConfig, setDraftConfig, useDraftConfigStore } from '../../runtime/draft-config';
import { useNewThreadReady } from '../../runtime/new-thread-ready-store';
import { markDraftDiscarded, isDraftDiscarded, useDiscardedDraftStore } from '../discarded-drafts';
import { useComposerSegments } from '@/features/chat/composer/segments/segment-store';
import { useSessionReferences } from '@/features/chat/composer/sessions/session-reference-store';
const abandonCreateForLocal = vi.fn();
vi.mock('../../runtime/new-thread-coordinator', () => ({
  abandonCreateForLocal: (...args: unknown[]) => abandonCreateForLocal(...args),
}));
import { resetNewThreadDraft } from '../reset-new-thread-draft';

beforeEach(() => {
  useDraftConfigStore.setState({ drafts: new Map() });
  useNewThreadReady.setState({ readyIds: new Set() });
  useDiscardedDraftStore.setState({ ids: new Set() });
  useComposerSegments.setState({ byThread: {} });
  useSessionReferences.setState({ byThread: {} });
  abandonCreateForLocal.mockReset();
});

describe('resetNewThreadDraft', () => {
  it('clears both the draft config and the ready flag for the given local id', () => {
    setDraftConfig('__LOCALID_1', { projectId: 'proj-A', adapterId: 'claude' });
    useNewThreadReady.getState().markReady('__LOCALID_1');

    resetNewThreadDraft('__LOCALID_1');

    expect(getDraftConfig('__LOCALID_1')).toBeUndefined();
    expect(useNewThreadReady.getState().isReady('__LOCALID_1')).toBe(false);
    expect(abandonCreateForLocal).toHaveBeenCalledExactlyOnceWith('__LOCALID_1');
  });

  it('leaves other local ids untouched', () => {
    setDraftConfig('__LOCALID_1', { projectId: 'proj-A', adapterId: 'claude' });
    setDraftConfig('__LOCALID_2', { projectId: 'proj-B', adapterId: 'claude' });
    useNewThreadReady.getState().markReady('__LOCALID_2');

    resetNewThreadDraft('__LOCALID_1');

    expect(getDraftConfig('__LOCALID_2')?.projectId).toBe('proj-B');
    expect(useNewThreadReady.getState().isReady('__LOCALID_2')).toBe(true);
  });

  it('is a no-op for an empty slot (undefined / null id)', () => {
    expect(() => resetNewThreadDraft(undefined)).not.toThrow();
    expect(() => resetNewThreadDraft(null)).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // Regression: resetNewThreadDraft is the canonical "start a fresh New
  // action" reset point (pill-active "+", the project picker's pick(), and
  // ⌘N all call it) — it must also clear the discarded-draft suppression
  // marker so a recycled localId's genuinely new New arms normally again.
  // -------------------------------------------------------------------------
  it('clears the discarded-draft marker for the given local id', () => {
    markDraftDiscarded('__LOCALID_1');
    expect(isDraftDiscarded('__LOCALID_1')).toBe(true);

    resetNewThreadDraft('__LOCALID_1');

    expect(isDraftDiscarded('__LOCALID_1')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Regression: composer segments are keyed by the SAME reused `__LOCALID_*`
  // id. Quoting a file into a draft and then abandoning it (switch away, New
  // again) used to bring the pill back on the reused slot — and
  // serializeComposition would prepend that quote to a message sent in a
  // DIFFERENT project.
  // -------------------------------------------------------------------------
  it("clears the reused slot's composer segments", () => {
    useComposerSegments.getState().append('__LOCALID_1', { quote: 'src/a.ts:1-3', liveText: 'about this' });
    expect(useComposerSegments.getState().byThread['__LOCALID_1']?.liveQuote).not.toBeNull();

    resetNewThreadDraft('__LOCALID_1');

    expect(useComposerSegments.getState().byThread['__LOCALID_1']).toEqual({ committed: [], liveQuote: null });
  });

  it("leaves another thread's segments untouched", () => {
    useComposerSegments.getState().append('__LOCALID_1', { quote: 'Q1', liveText: '' });
    useComposerSegments.getState().append('chat-42', { quote: 'Q2', liveText: '' });

    resetNewThreadDraft('__LOCALID_1');

    expect(useComposerSegments.getState().byThread['chat-42']?.liveQuote?.text).toBe('Q2');
  });

  // -------------------------------------------------------------------------
  // Regression (#240): session references are keyed by the same reused id, so
  // an abandoned draft's `@session[label]` binding would attach a foreign
  // project's transcript path to the next New's message.
  // -------------------------------------------------------------------------
  it("clears the reused slot's session references", () => {
    useSessionReferences.getState().record('__LOCALID_1', 'Foo refactor', '/tmp/a.jsonl');
    useSessionReferences.getState().record('chat-42', 'Bar', '/tmp/b.jsonl');

    resetNewThreadDraft('__LOCALID_1');

    expect(useSessionReferences.getState().byThread['__LOCALID_1']).toEqual({});
    expect(useSessionReferences.getState().byThread['chat-42']).toEqual({ Bar: '/tmp/b.jsonl' });
  });
});
