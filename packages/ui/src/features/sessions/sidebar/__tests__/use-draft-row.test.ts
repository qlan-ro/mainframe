// @vitest-environment jsdom
/**
 * useDraftRow — navigation-away discard behavior (final-review fix).
 *
 * Spec: discard = the ✕ on the row OR selecting any OTHER session while the
 * draft is unsent → resetNewThreadDraft + clear the return target. Only the ✕
 * path (onDiscard) existed before; this covers the nav-away effect.
 *
 * Behaviors covered:
 *  1. Nav-away discard: a draft-config exists for newThreadId and mainThreadId
 *     switches to a DIFFERENT thread → resetNewThreadDraft(newThreadId) fires
 *     and the return target clears.
 *  2. Regression guard (first-send commit): the coordinator clears the draft
 *     config on commit while the id does NOT flip (mainThreadId stays equal to
 *     newThreadId, per new-thread-coordinator.ts) → the effect must NOT invoke
 *     resetNewThreadDraft.
 *  3. No-op while still composing: mainThreadId still equals the unsent draft's
 *     thread id (no navigation happened) → no reset.
 *  4. No-op at boot, before any main thread is selected (mainThreadId is the
 *     empty-string boot default, not a real "other" thread) → no reset.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDraftConfigStore, setDraftConfig, getDraftConfig } from '../../runtime/draft-config';
import { useDraftReturnTarget } from '../../new-thread/use-draft-return-target';
import { useDiscardedDraftStore, isDraftDiscarded } from '../../new-thread/discarded-drafts';

type FakeAuiState = { threads: { mainThreadId: string; newThreadId: string | null } };

let fakeAuiState: FakeAuiState = { threads: { mainThreadId: '', newThreadId: null } };
const switchToThreadSpy = vi.fn();

vi.mock('@assistant-ui/react', () => ({
  useAssistantRuntime: () => ({ threads: { switchToThread: switchToThreadSpy } }),
  useAuiState: (selector: (s: FakeAuiState) => unknown) => selector(fakeAuiState),
}));

vi.mock('../../new-thread/reset-new-thread-draft', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../new-thread/reset-new-thread-draft')>();
  return { resetNewThreadDraft: vi.fn(actual.resetNewThreadDraft) };
});

import { resetNewThreadDraft } from '../../new-thread/reset-new-thread-draft';
import { useDraftRow } from '../use-draft-row';

const mockResetNewThreadDraft = vi.mocked(resetNewThreadDraft);

beforeEach(() => {
  vi.clearAllMocks();
  useDraftConfigStore.setState({ drafts: new Map() });
  useDraftReturnTarget.setState({ returnThreadId: null });
  useDiscardedDraftStore.setState({ ids: new Set() });
  switchToThreadSpy.mockReset();
  fakeAuiState = { threads: { mainThreadId: '__LOCALID_draft', newThreadId: '__LOCALID_draft' } };
});

describe('useDraftRow — discards an unsent draft on navigation-away', () => {
  it('resets the draft when mainThreadId switches to a different thread while unsent', () => {
    setDraftConfig('__LOCALID_draft', { projectId: 'proj-a', adapterId: 'claude' });
    useDraftReturnTarget.getState().setReturnTarget('chat-prev');

    const { rerender } = renderHook(() => useDraftRow([], null));
    expect(mockResetNewThreadDraft).not.toHaveBeenCalled();

    // The user selects a different session while the draft is still unsent.
    fakeAuiState = { threads: { mainThreadId: 'chat-other', newThreadId: '__LOCALID_draft' } };
    rerender();

    expect(mockResetNewThreadDraft).toHaveBeenCalledWith('__LOCALID_draft');
    expect(getDraftConfig('__LOCALID_draft')).toBeUndefined();
    expect(useDraftReturnTarget.getState().returnThreadId).toBeNull();
  });
});

describe('useDraftRow — regression guard: first-send commit is not mistaken for navigation-away', () => {
  it('does not invoke resetNewThreadDraft when the draft commits (config cleared, id unchanged)', () => {
    setDraftConfig('__LOCALID_draft', { projectId: 'proj-a', adapterId: 'claude' });

    const { rerender } = renderHook(() => useDraftRow([], null));
    expect(mockResetNewThreadDraft).not.toHaveBeenCalled();

    // Mirrors new-thread-coordinator.createForLocal's success path: the draft
    // config is cleared, but the thread keeps the SAME local id (no id-flip) —
    // mainThreadId still equals newThreadId.
    useDraftConfigStore.getState().clearDraft('__LOCALID_draft');
    rerender();

    expect(mockResetNewThreadDraft).not.toHaveBeenCalled();
  });
});

describe('useDraftRow — no-op while still composing the draft (no navigation)', () => {
  it('does not reset while mainThreadId still equals the unsent draft thread', () => {
    setDraftConfig('__LOCALID_draft', { projectId: 'proj-a', adapterId: 'claude' });

    renderHook(() => useDraftRow([], null));

    expect(mockResetNewThreadDraft).not.toHaveBeenCalled();
    expect(getDraftConfig('__LOCALID_draft')).toBeDefined();
  });
});

describe('useDraftRow — no-op at boot before a main thread is selected', () => {
  it('does not reset when mainThreadId is the empty-string boot default', () => {
    fakeAuiState = { threads: { mainThreadId: '', newThreadId: '__LOCALID_draft' } };
    setDraftConfig('__LOCALID_draft', { projectId: 'proj-a', adapterId: 'claude' });

    renderHook(() => useDraftRow([], null));

    expect(mockResetNewThreadDraft).not.toHaveBeenCalled();
    expect(getDraftConfig('__LOCALID_draft')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Regression (bug z): SessionsNewButton.pick() race with switchToNewThread()
//
// pick() synchronously does setDraftConfig(nid, {...}) THEN
// `void runtime.threads.switchToNewThread()` — an aui call that awaits an
// internal hook task before mainThreadId catches up to newThreadId. That
// means there is a REAL render where hasDraft is newly true but mainThreadId
// still points at whatever session was active before New was clicked (an
// EXISTING chat, not the new draft slot) — i.e. mainThreadId !== newThreadId,
// exactly the shape the discard-on-navigate-away effect was watching for.
// The effect must NOT fire here: mainThreadId was never pointing at this
// draft to begin with, so this isn't "navigated away", it's "hasn't arrived
// yet". Only firing after having genuinely been selected (mainThreadId ===
// newThreadId at some prior render) distinguishes the two.
// ---------------------------------------------------------------------------

describe('useDraftRow — regression: pending create-to-switch handoff is not mistaken for navigation-away', () => {
  it('does not reset a freshly-armed draft while mainThreadId still points at the previously-active session', () => {
    // Before New is clicked: an existing chat is active, and aui's preallocated
    // new-thread slot is a different, not-yet-selected id.
    fakeAuiState = { threads: { mainThreadId: 'chat-existing', newThreadId: '__LOCALID_pending' } };

    const { rerender } = renderHook(() => useDraftRow([], null));
    expect(mockResetNewThreadDraft).not.toHaveBeenCalled();

    // pick() fires: setDraftConfig lands synchronously, but
    // switchToNewThread() hasn't resolved yet — mainThreadId is UNCHANGED.
    setDraftConfig('__LOCALID_pending', { projectId: 'proj-a', adapterId: 'claude' });
    rerender();

    expect(mockResetNewThreadDraft).not.toHaveBeenCalled();
    expect(getDraftConfig('__LOCALID_pending')).toBeDefined();

    // switchToNewThread() resolves — mainThreadId catches up to the draft.
    fakeAuiState = { threads: { mainThreadId: '__LOCALID_pending', newThreadId: '__LOCALID_pending' } };
    rerender();
    expect(mockResetNewThreadDraft).not.toHaveBeenCalled();

    // NOW a genuine navigation away must still discard it.
    fakeAuiState = { threads: { mainThreadId: 'chat-other', newThreadId: '__LOCALID_pending' } };
    rerender();
    expect(mockResetNewThreadDraft).toHaveBeenCalledWith('__LOCALID_pending');
  });
});

// ---------------------------------------------------------------------------
// Regression (bug: draft discard is a no-op with a pill active)
//
// onDiscard() must mark the local id as discarded (discarded-drafts.ts) so
// useNewThreadAutoConfig doesn't instantly re-seed the very draft the user
// just closed while switchToThread's async handoff away is still in flight.
// ---------------------------------------------------------------------------

describe('useDraftRow — onDiscard marks the local id as discarded', () => {
  it('leaves the local id marked discarded after the ✕ handler runs', () => {
    setDraftConfig('__LOCALID_draft', { projectId: 'proj-a', adapterId: 'claude' });
    expect(isDraftDiscarded('__LOCALID_draft')).toBe(false);

    const { result } = renderHook(() => useDraftRow([], 'proj-a'));
    act(() => {
      result.current.onDiscard();
    });

    expect(isDraftDiscarded('__LOCALID_draft')).toBe(true);
  });
});
