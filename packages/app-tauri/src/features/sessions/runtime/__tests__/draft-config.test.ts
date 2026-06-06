import { describe, it, expect, afterEach } from 'vitest';
import { getDraftConfig, setDraftConfig, clearDraftConfig } from '../draft-config';

// ---------------------------------------------------------------------------
// Reset singleton state between tests
// ---------------------------------------------------------------------------

afterEach(() => {
  clearDraftConfig('__LOCALID_x');
  clearDraftConfig('__LOCALID_y');
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
