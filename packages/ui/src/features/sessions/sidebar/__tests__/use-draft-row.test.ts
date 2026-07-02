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
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDraftConfigStore, setDraftConfig, getDraftConfig } from '../../runtime/draft-config';
import { useDraftReturnTarget } from '../../new-thread/use-draft-return-target';

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
