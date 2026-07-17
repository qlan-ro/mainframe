import { it, expect, afterEach } from 'vitest';
import {
  getDraftConfig,
  setDraftConfig,
  clearDraftConfig,
  patchDraftConfig,
  useDraftConfigStore,
} from '../draft-config';

afterEach(() => {
  clearDraftConfig('__LOCALID_x');
  clearDraftConfig('__LOCALID_y');
  clearDraftConfig('__LOCALID_z');
});

it('returns undefined before any set, then round-trips every field (required, optional, tuning) across a single set call', () => {
  expect(getDraftConfig('__LOCALID_x')).toBeUndefined();

  const full = {
    projectId: 'p1',
    adapterId: 'claude',
    permissionMode: 'default' as const,
    model: 'gpt-5',
    worktreePath: '/wt',
    branchName: 'feat/x',
    effort: 'high' as const,
    fast: false,
    ultracode: true,
    adaptiveThinking: null,
    planMode: true,
  };
  setDraftConfig('__LOCALID_x', full);

  expect(getDraftConfig('__LOCALID_x')).toEqual(full);
});

it('setDraftConfig overwrites a previous entry on a repeated call for the same id', () => {
  setDraftConfig('__LOCALID_x', { projectId: 'p1', adapterId: 'claude', permissionMode: 'default' });
  setDraftConfig('__LOCALID_x', { projectId: 'p9', adapterId: 'gemini', permissionMode: 'default' });

  expect(getDraftConfig('__LOCALID_x')).toEqual({ projectId: 'p9', adapterId: 'gemini', permissionMode: 'default' });
});

it('clearDraftConfig removes a stored entry, and is a no-op for an id that was never set', () => {
  setDraftConfig('__LOCALID_x', { projectId: 'p1', adapterId: 'claude', permissionMode: 'default' });
  clearDraftConfig('__LOCALID_x');
  expect(getDraftConfig('__LOCALID_x')).toBeUndefined();

  expect(() => clearDraftConfig('__LOCALID_x')).not.toThrow();
});

it("patchDraftConfig merges a partial update onto an existing draft, is a no-op with no existing draft, and only churns the patched id's object ref", () => {
  setDraftConfig('__LOCALID_x', {
    projectId: 'p1',
    adapterId: 'claude',
    permissionMode: 'default',
    effort: 'medium',
    fast: true,
  });
  setDraftConfig('__LOCALID_y', { projectId: 'p2', adapterId: 'codex', permissionMode: 'default' });

  const beforeX = getDraftConfig('__LOCALID_x');
  const beforeY = getDraftConfig('__LOCALID_y');
  const beforeMapRefY = useDraftConfigStore.getState().drafts.get('__LOCALID_y');

  patchDraftConfig('__LOCALID_x', { model: 'claude-3-opus', ultracode: true });

  const afterX = getDraftConfig('__LOCALID_x');
  expect(afterX).toEqual({
    projectId: 'p1',
    adapterId: 'claude',
    permissionMode: 'default',
    effort: 'medium',
    fast: true,
    model: 'claude-3-opus',
    ultracode: true,
  });
  // Reactivity: the patched id gets a new object ref; untouched ids don't churn.
  expect(afterX).not.toBe(beforeX);
  expect(getDraftConfig('__LOCALID_y')).toBe(beforeY);
  expect(useDraftConfigStore.getState().drafts.get('__LOCALID_y')).toBe(beforeMapRefY);

  patchDraftConfig('__LOCALID_z', { model: 'claude-3-opus' });
  expect(getDraftConfig('__LOCALID_z')).toBeUndefined();
});
