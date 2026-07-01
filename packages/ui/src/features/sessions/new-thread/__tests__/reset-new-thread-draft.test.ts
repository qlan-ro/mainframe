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
import { describe, it, expect, beforeEach } from 'vitest';
import { getDraftConfig, setDraftConfig, useDraftConfigStore } from '../../runtime/draft-config';
import { useNewThreadReady } from '../../runtime/new-thread-ready-store';
import { resetNewThreadDraft } from '../reset-new-thread-draft';

beforeEach(() => {
  useDraftConfigStore.setState({ drafts: new Map() });
  useNewThreadReady.setState({ readyIds: new Set() });
});

describe('resetNewThreadDraft', () => {
  it('clears both the draft config and the ready flag for the given local id', () => {
    setDraftConfig('__LOCALID_1', { projectId: 'proj-A', adapterId: 'claude' });
    useNewThreadReady.getState().markReady('__LOCALID_1');

    resetNewThreadDraft('__LOCALID_1');

    expect(getDraftConfig('__LOCALID_1')).toBeUndefined();
    expect(useNewThreadReady.getState().isReady('__LOCALID_1')).toBe(false);
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
});
