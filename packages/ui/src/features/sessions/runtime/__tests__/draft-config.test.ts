import { describe, it, expect, afterEach } from 'vitest';
import {
  getDraftConfig,
  setDraftConfig,
  clearDraftConfig,
  patchDraftConfig,
  useDraftConfigStore,
} from '../draft-config';

// ---------------------------------------------------------------------------
// Reset singleton state between tests
// ---------------------------------------------------------------------------

afterEach(() => {
  clearDraftConfig('__LOCALID_x');
  clearDraftConfig('__LOCALID_y');
  clearDraftConfig('__LOCALID_z');
});

// ---------------------------------------------------------------------------
// draft-config
// ---------------------------------------------------------------------------

describe('draft-config — getDraftConfig returns undefined before any set', () => {
  it('returns undefined for an unknown local id', () => {
    expect(getDraftConfig('__LOCALID_x')).toBeUndefined();
  });
});

describe('draft-config — setDraftConfig stores required fields', () => {
  it('stores the config and getDraftConfig retrieves it exactly', () => {
    setDraftConfig('__LOCALID_x', {
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'default',
    });
    expect(getDraftConfig('__LOCALID_x')).toEqual({
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'default',
    });
  });
});

describe('draft-config — setDraftConfig stores optional fields', () => {
  it('stores all optional fields and retrieves them exactly', () => {
    setDraftConfig('__LOCALID_y', {
      projectId: 'p2',
      adapterId: 'codex',
      model: 'gpt-5',
      permissionMode: 'plan',
      worktreePath: '/wt',
      branchName: 'feat/x',
    });
    expect(getDraftConfig('__LOCALID_y')).toEqual({
      projectId: 'p2',
      adapterId: 'codex',
      model: 'gpt-5',
      permissionMode: 'plan',
      worktreePath: '/wt',
      branchName: 'feat/x',
    });
  });
});

describe('draft-config — setDraftConfig overwrites an existing entry', () => {
  it('replaces the previous config when called again with the same id', () => {
    setDraftConfig('__LOCALID_x', {
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'default',
    });
    setDraftConfig('__LOCALID_x', {
      projectId: 'p9',
      adapterId: 'gemini',
      permissionMode: 'default',
    });
    const result = getDraftConfig('__LOCALID_x');
    expect(result?.projectId).toBe('p9');
  });
});

describe('draft-config — clearDraftConfig removes a stored entry', () => {
  it('returns undefined after clearing a previously set id', () => {
    setDraftConfig('__LOCALID_x', {
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'default',
    });
    clearDraftConfig('__LOCALID_x');
    expect(getDraftConfig('__LOCALID_x')).toBeUndefined();
  });
});

describe('draft-config — clearDraftConfig is a no-op for unknown id', () => {
  it('does not throw when clearing an id that was never set', () => {
    expect(() => clearDraftConfig('__LOCALID_x')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// patchDraftConfig — merges onto an existing draft
// ---------------------------------------------------------------------------

describe('draft-config — patchDraftConfig merges onto an existing draft', () => {
  it('patches a single field while preserving the others', () => {
    setDraftConfig('__LOCALID_x', {
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'default',
      model: 'claude-3-sonnet',
    });

    patchDraftConfig('__LOCALID_x', { model: 'claude-3-opus' });

    expect(getDraftConfig('__LOCALID_x')).toEqual({
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'default',
      model: 'claude-3-opus',
    });
  });

  it('preserves untouched fields when patching effort', () => {
    setDraftConfig('__LOCALID_x', {
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'default',
      fast: true,
    });

    patchDraftConfig('__LOCALID_x', { effort: 'high' });

    const result = getDraftConfig('__LOCALID_x');
    // Original fields untouched:
    expect(result?.projectId).toBe('p1');
    expect(result?.adapterId).toBe('claude');
    expect(result?.permissionMode).toBe('default');
    expect(result?.fast).toBe(true);
    // Patched field applied:
    expect(result?.effort).toBe('high');
  });

  it('is a no-op when no draft exists for the given id', () => {
    patchDraftConfig('__LOCALID_x', { model: 'claude-3-opus' });

    expect(getDraftConfig('__LOCALID_x')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// patchDraftConfig — produces a NEW object ref for the patched id
// ---------------------------------------------------------------------------

describe('draft-config — patchDraftConfig produces a new object ref for the patched id', () => {
  it('the patched id gets a different object ref while other ids keep identical refs', () => {
    setDraftConfig('__LOCALID_x', {
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'default',
    });
    setDraftConfig('__LOCALID_y', {
      projectId: 'p2',
      adapterId: 'codex',
      permissionMode: 'default',
    });

    const beforeX = getDraftConfig('__LOCALID_x');
    const beforeY = getDraftConfig('__LOCALID_y');
    const beforeMapRef = useDraftConfigStore.getState().drafts.get('__LOCALID_y');

    patchDraftConfig('__LOCALID_x', { model: 'claude-3-opus' });

    const afterX = getDraftConfig('__LOCALID_x');
    const afterY = getDraftConfig('__LOCALID_y');
    const afterMapRef = useDraftConfigStore.getState().drafts.get('__LOCALID_y');

    // The patched id has a new object ref (reactivity: subscribers re-render).
    expect(afterX).not.toBe(beforeX);
    // The other id's object ref is identical (no unnecessary churn).
    expect(afterY).toBe(beforeY);
    expect(afterMapRef).toBe(beforeMapRef);
  });
});

// ---------------------------------------------------------------------------
// New tuning fields — round-trip via set + get
// ---------------------------------------------------------------------------

describe('draft-config — tuning fields round-trip', () => {
  it('stores and retrieves effort, fast, ultracode, adaptiveThinking', () => {
    setDraftConfig('__LOCALID_x', {
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'default',
      effort: 'high',
      fast: false,
      ultracode: true,
      adaptiveThinking: null,
    });

    expect(getDraftConfig('__LOCALID_x')).toEqual({
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'default',
      effort: 'high',
      fast: false,
      ultracode: true,
      adaptiveThinking: null,
    });
  });

  it('stores and retrieves planMode', () => {
    setDraftConfig('__LOCALID_x', {
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'default',
      planMode: true,
    });

    expect(getDraftConfig('__LOCALID_x')?.planMode).toBe(true);
  });

  it('patchDraftConfig updates ultracode to true while leaving effort intact', () => {
    setDraftConfig('__LOCALID_x', {
      projectId: 'p1',
      adapterId: 'claude',
      permissionMode: 'default',
      effort: 'medium',
      ultracode: false,
    });

    patchDraftConfig('__LOCALID_x', { ultracode: true });

    const result = getDraftConfig('__LOCALID_x');
    expect(result?.ultracode).toBe(true);
    expect(result?.effort).toBe('medium');
  });
});
