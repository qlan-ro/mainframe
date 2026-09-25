/**
 * pending-draft-project — stash ownership.
 *
 * setPendingProject returns a token; clearPendingProject only clears the
 * stash when the token it is given still matches the stash's current owner.
 * This lets an earlier trigger's `finally` settle after a later trigger has
 * already stashed its own target without clobbering it (todo #365).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { usePendingDraftProject, getPendingDraftProject } from '../pending-draft-project';

beforeEach(() => {
  usePendingDraftProject.setState({ projectId: null });
});

describe('pending-draft-project — stash ownership', () => {
  it('setPendingProject stashes the id and returns a token', () => {
    const token = usePendingDraftProject.getState().setPendingProject('proj-a');
    expect(getPendingDraftProject()).toBe('proj-a');
    expect(typeof token).toBe('number');
  });

  it('clearPendingProject clears when the token still owns the stash', () => {
    const token = usePendingDraftProject.getState().setPendingProject('proj-a');
    usePendingDraftProject.getState().clearPendingProject(token);
    expect(getPendingDraftProject()).toBeNull();
  });

  it("an earlier request's clear does not clobber a later request's stash", () => {
    const earlierToken = usePendingDraftProject.getState().setPendingProject('proj-a');
    const laterToken = usePendingDraftProject.getState().setPendingProject('proj-b');

    // The earlier trigger's `finally` runs after the later trigger already stashed.
    usePendingDraftProject.getState().clearPendingProject(earlierToken);

    expect(getPendingDraftProject()).toBe('proj-b');
    expect(laterToken).not.toBe(earlierToken);
  });

  it('a stale token cannot clear a later, still-current stash', () => {
    const token = usePendingDraftProject.getState().setPendingProject('proj-a');
    usePendingDraftProject.getState().setPendingProject('proj-b');
    usePendingDraftProject.getState().clearPendingProject(token);
    expect(getPendingDraftProject()).toBe('proj-b');
  });
});
