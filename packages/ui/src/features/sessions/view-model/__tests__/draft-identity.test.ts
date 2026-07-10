/**
 * draft-identity — pure derivation for the draft-aware active identity.
 *
 * A new (`__LOCALID_*`) thread has no aui `custom` until the first send creates
 * the daemon chat, so every custom-derived surface (file tree, branch chip,
 * skills, launch scope) went dark while composing (todo #223). These tests pin
 * the resolution order: the freshest session custom wins wholesale; a draft
 * config fills in ONLY when no custom exists; and the first-send gap (draft
 * consumed, reload not yet landed) is bridged by the last resolved scope for
 * the SAME thread item.
 */
import { describe, it, expect } from 'vitest';
import type { SessionCustom } from '../chat-to-thread-custom';
import type { DraftCfg } from '../../runtime/draft-config';
import { resolveActiveScope, bridgeScopeGap, type ScopeCache } from '../draft-identity';

function makeCustom(overrides?: Partial<SessionCustom>): SessionCustom {
  return {
    projectId: 'proj-live',
    adapterId: 'claude',
    tags: [],
    pinned: false,
    status: 'active',
    displayStatus: 'idle',
    hasPending: false,
    detectedPrs: [],
    worktreeMissing: false,
    transcriptMissing: false,
    updatedAt: 0,
    ...overrides,
  };
}

function makeDraft(overrides?: Partial<DraftCfg>): DraftCfg {
  return { projectId: 'proj-draft', adapterId: 'codex', ...overrides };
}

describe('resolveActiveScope — custom wins wholesale', () => {
  it('returns all scope fields from custom when present', () => {
    const custom = makeCustom({ branchName: 'main', worktreePath: '/wt/live' });
    expect(resolveActiveScope(custom, makeDraft())).toEqual({
      projectId: 'proj-live',
      adapterId: 'claude',
      branchName: 'main',
      worktreePath: '/wt/live',
      isWorktree: true,
    });
  });

  it('derives isWorktree=false from a custom without a worktree', () => {
    expect(resolveActiveScope(makeCustom(), undefined).isWorktree).toBe(false);
  });

  it('never mixes draft fields into a live custom (undefined custom fields stay undefined)', () => {
    const custom = makeCustom(); // no branchName / worktreePath
    const scope = resolveActiveScope(custom, makeDraft({ branchName: 'feat/x', worktreePath: '/wt/draft' }));
    expect(scope.branchName).toBeUndefined();
    expect(scope.worktreePath).toBeUndefined();
  });
});

describe('resolveActiveScope — draft fallback for a not-yet-created thread', () => {
  it('resolves projectId + adapterId from the draft when no custom exists', () => {
    expect(resolveActiveScope(undefined, makeDraft())).toEqual({
      projectId: 'proj-draft',
      adapterId: 'codex',
      branchName: undefined,
      worktreePath: undefined,
      isWorktree: false,
    });
  });

  it('surfaces a pre-send worktree attach (worktreePath + branchName + isWorktree) from the draft', () => {
    const scope = resolveActiveScope(undefined, makeDraft({ worktreePath: '/wt/feat', branchName: 'feat/y' }));
    expect(scope.worktreePath).toBe('/wt/feat');
    expect(scope.branchName).toBe('feat/y');
    expect(scope.isWorktree).toBe(true);
  });

  it('surfaces a pending NEW worktree as the draft branch, without fabricating a path', () => {
    // The worktree does not exist until first send — the chip shows the chosen
    // branch (intent, matching the attach case) but no path-scoped surface
    // (file tree, launch scope) may point at a directory that isn't there yet.
    const scope = resolveActiveScope(
      undefined,
      makeDraft({ pendingWorktree: { baseBranch: 'main', branchName: 'feat/pending' } }),
    );
    expect(scope.branchName).toBe('feat/pending');
    expect(scope.isWorktree).toBe(true);
    expect(scope.worktreePath).toBeUndefined();
  });

  it('returns an empty scope when neither custom nor draft exists', () => {
    expect(resolveActiveScope(undefined, undefined)).toEqual({ isWorktree: false });
  });
});

describe('bridgeScopeGap — first-send gap continuity', () => {
  const resolved = { projectId: 'p1', adapterId: 'claude' };

  it('passes a resolved scope through and caches it for the item', () => {
    const { scope, cache } = bridgeScopeGap(null, '__LOCALID_1', resolved);
    expect(scope).toBe(resolved);
    expect(cache).toEqual({ itemId: '__LOCALID_1', scope: resolved });
  });

  it('returns the cached scope while the SAME item momentarily has none (draft consumed, reload pending)', () => {
    const cache: ScopeCache = { itemId: '__LOCALID_1', scope: resolved };
    const { scope, cache: next } = bridgeScopeGap(cache, '__LOCALID_1', {});
    expect(scope).toBe(resolved);
    expect(next).toBe(cache);
  });

  it('does NOT leak the cached scope to a DIFFERENT item id', () => {
    const cache: ScopeCache = { itemId: '__LOCALID_1', scope: resolved };
    const { scope, cache: next } = bridgeScopeGap(cache, '__LOCALID_2', {});
    expect(scope).toEqual({});
    expect(next).toBeNull();
  });

  it('replaces the cache when the same item resolves a NEW scope', () => {
    const cache: ScopeCache = { itemId: '__LOCALID_1', scope: resolved };
    const fresh = { projectId: 'p2', adapterId: 'codex' };
    const { scope, cache: next } = bridgeScopeGap(cache, '__LOCALID_1', fresh);
    expect(scope).toBe(fresh);
    expect(next).toEqual({ itemId: '__LOCALID_1', scope: fresh });
  });

  it('returns the raw empty scope with no cache when there is no active item', () => {
    const { scope, cache } = bridgeScopeGap({ itemId: '__LOCALID_1', scope: resolved }, null, {});
    expect(scope).toEqual({});
    expect(cache).toBeNull();
  });
});
