import { describe, it, expect, beforeEach } from 'vitest';
import { readInFlightNewSessionTarget } from '../in-flight-new-session-target';
import { usePendingDraftProject } from '../pending-draft-project';
import { useNewThreadReady } from '../../runtime/new-thread-ready-store';
import type { DraftCfg } from '../../runtime/draft-config';

const noopRetry = (async () => ({}) as DraftCfg) as () => Promise<DraftCfg>;

beforeEach(() => {
  usePendingDraftProject.setState({ projectId: null, token: 0 });
  useNewThreadReady.setState({ readyIds: new Set(), initializations: new Map() });
});

describe('readInFlightNewSessionTarget', () => {
  it('returns no target when the active thread is not the slot, even with a stash set', () => {
    usePendingDraftProject.getState().setPendingProject('proj-a');
    expect(readInFlightNewSessionTarget('__LOCALID_1', false)).toEqual({ target: null, blocking: false });
  });

  it('reads the pending stash as blocking', () => {
    usePendingDraftProject.getState().setPendingProject('proj-a');
    expect(readInFlightNewSessionTarget('__LOCALID_1', true)).toEqual({ target: 'proj-a', blocking: true });
  });

  it('falls back to an initializing record as blocking', () => {
    useNewThreadReady.getState().beginInitialization('__LOCALID_1', noopRetry, 'proj-b');
    expect(readInFlightNewSessionTarget('__LOCALID_1', true)).toEqual({ target: 'proj-b', blocking: true });
  });

  it('a ready record is a non-blocking target', () => {
    const attempt = useNewThreadReady.getState().beginInitialization('__LOCALID_1', noopRetry, 'proj-c');
    useNewThreadReady.getState().completeInitialization('__LOCALID_1', attempt);
    expect(readInFlightNewSessionTarget('__LOCALID_1', true)).toEqual({ target: 'proj-c', blocking: false });
  });

  it('an error record is a non-blocking target', () => {
    const attempt = useNewThreadReady.getState().beginInitialization('__LOCALID_1', noopRetry, 'proj-d');
    useNewThreadReady.getState().failInitialization('__LOCALID_1', attempt, new Error('boom'));
    expect(readInFlightNewSessionTarget('__LOCALID_1', true)).toEqual({ target: 'proj-d', blocking: false });
  });

  it('no stash and no record returns no target', () => {
    expect(readInFlightNewSessionTarget('__LOCALID_1', true)).toEqual({ target: null, blocking: false });
  });
});
