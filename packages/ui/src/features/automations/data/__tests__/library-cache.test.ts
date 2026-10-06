import { describe, expect, it } from 'vitest';
import type { AutomationRunSummary, AutomationSummary } from '../../contract';
import {
  ALL_SCOPE,
  EMPTY_LIBRARY,
  findDefinitionInCache,
  findRunInCache,
  patchDefinitionInCache,
  patchRunInCache,
  removeDefinitionFromCache,
  runsForAutomation,
  scopeKeyOf,
  type LibraryCache,
} from '../library-cache';

const def = (id: string, projectId: string | null = null): AutomationSummary => ({
  id,
  name: id,
  scope: projectId == null ? 'global' : 'project',
  projectId,
  enabled: true,
  definition: { triggers: [], steps: [] },
  createdAt: 1,
  updatedAt: 1,
});

const run = (id: string, automationId: string, startedAt = 1): AutomationRunSummary => ({
  id,
  automationId,
  status: 'running',
  trigger: { kind: 'manual' },
  startedAt,
  finishedAt: null,
  error: null,
});

describe('scopeKeyOf', () => {
  it('maps a projectId straight through', () => {
    expect(scopeKeyOf('proj-1')).toBe('proj-1');
  });

  it('maps null and undefined to the ALL_SCOPE key', () => {
    expect(scopeKeyOf(null)).toBe(ALL_SCOPE);
    expect(scopeKeyOf(undefined)).toBe(ALL_SCOPE);
    expect(ALL_SCOPE).toBe('all');
  });
});

describe('EMPTY_LIBRARY', () => {
  it('is the frozen, empty, not-loading, no-error default', () => {
    expect(EMPTY_LIBRARY).toEqual({ definitions: [], runs: [], loading: false, error: null, loadedAt: null });
    expect(Object.isFrozen(EMPTY_LIBRARY)).toBe(true);
  });
});

describe('patchDefinitionInCache', () => {
  it('appends a project-scoped definition only to its own project entry and "all"', () => {
    const cache: LibraryCache = {
      'proj-a': { ...EMPTY_LIBRARY },
      'proj-b': { ...EMPTY_LIBRARY },
      all: { ...EMPTY_LIBRARY },
    };
    const next = patchDefinitionInCache(cache, def('new-1', 'proj-a'));
    expect(next['proj-a']!.definitions.map((d) => d.id)).toEqual(['new-1']);
    expect(next.all!.definitions.map((d) => d.id)).toEqual(['new-1']);
    expect(next['proj-b']!.definitions).toEqual([]);
  });

  it('appends a global definition to every entry', () => {
    const cache: LibraryCache = { 'proj-a': { ...EMPTY_LIBRARY }, all: { ...EMPTY_LIBRARY } };
    const next = patchDefinitionInCache(cache, def('g1', null));
    expect(next['proj-a']!.definitions.map((d) => d.id)).toEqual(['g1']);
    expect(next.all!.definitions.map((d) => d.id)).toEqual(['g1']);
  });

  it('updates an existing definition in place (upsert by id) wherever it already lives', () => {
    const existing = def('a1', 'proj-a');
    const cache: LibraryCache = { 'proj-a': { ...EMPTY_LIBRARY, definitions: [existing] } };
    const updated = { ...existing, name: 'renamed' };
    const next = patchDefinitionInCache(cache, updated);
    expect(next['proj-a']!.definitions).toEqual([updated]);
  });

  it('leaves entries it does not belong in untouched (same array reference)', () => {
    const cache: LibraryCache = { 'proj-b': { ...EMPTY_LIBRARY } };
    const next = patchDefinitionInCache(cache, def('new-1', 'proj-a'));
    expect(next['proj-b']).toBe(cache['proj-b']!);
  });
});

describe('removeDefinitionFromCache', () => {
  it('removes the definition from every entry that holds it', () => {
    const d = def('a1', null);
    const cache: LibraryCache = {
      'proj-a': { ...EMPTY_LIBRARY, definitions: [d] },
      all: { ...EMPTY_LIBRARY, definitions: [d] },
      'proj-b': { ...EMPTY_LIBRARY },
    };
    const next = removeDefinitionFromCache(cache, 'a1');
    expect(next['proj-a']!.definitions).toEqual([]);
    expect(next.all!.definitions).toEqual([]);
    expect(next['proj-b']).toBe(cache['proj-b']!);
  });

  it('is a no-op (same cache reference) when no entry holds the id', () => {
    const cache: LibraryCache = { 'proj-a': { ...EMPTY_LIBRARY } };
    expect(removeDefinitionFromCache(cache, 'missing')).toBe(cache);
  });
});

describe('patchRunInCache', () => {
  it('prepends a new run only to entries holding its automation', () => {
    const d = def('a1', null);
    const cache: LibraryCache = {
      'proj-a': { ...EMPTY_LIBRARY, definitions: [d] },
      'proj-b': { ...EMPTY_LIBRARY }, // does not hold a1
    };
    const r = run('r1', 'a1');
    const next = patchRunInCache(cache, r);
    expect(next['proj-a']!.runs).toEqual([r]);
    expect(next['proj-b']).toBe(cache['proj-b']!);
  });

  it('upserts an existing run by id in place, not prepended again', () => {
    const d = def('a1', null);
    const r = run('r1', 'a1');
    const cache: LibraryCache = { 'proj-a': { ...EMPTY_LIBRARY, definitions: [d], runs: [r] } };
    const updated = { ...r, status: 'succeeded' as const };
    const next = patchRunInCache(cache, updated);
    expect(next['proj-a']!.runs).toEqual([updated]);
  });

  it('returns the cache unchanged when the run belongs nowhere (automation not loaded anywhere)', () => {
    const cache: LibraryCache = { 'proj-a': { ...EMPTY_LIBRARY } };
    expect(patchRunInCache(cache, run('r1', 'ghost'))).toBe(cache);
  });
});

describe('findRunInCache / findDefinitionInCache', () => {
  it('finds a run in whichever entry holds it', () => {
    const r = run('r1', 'a1');
    const cache: LibraryCache = { 'proj-a': { ...EMPTY_LIBRARY, runs: [r] } };
    expect(findRunInCache(cache, 'r1')).toBe(r);
    expect(findRunInCache(cache, 'missing')).toBeUndefined();
  });

  it('finds a definition in whichever entry holds it', () => {
    const d = def('a1', 'proj-a');
    const cache: LibraryCache = { 'proj-a': { ...EMPTY_LIBRARY, definitions: [d] } };
    expect(findDefinitionInCache(cache, 'a1')).toBe(d);
    expect(findDefinitionInCache(cache, 'missing')).toBeUndefined();
  });
});

describe('runsForAutomation', () => {
  it('deduplicates the same run seen in multiple scopes and sorts newest first', () => {
    const r1 = run('r1', 'a1', 1);
    const r2 = run('r2', 'a1', 5);
    const cache: LibraryCache = {
      'proj-a': { ...EMPTY_LIBRARY, runs: [r1, r2] },
      all: { ...EMPTY_LIBRARY, runs: [r1] }, // r1 duplicated across scopes
    };
    expect(runsForAutomation(cache, 'a1').map((r) => r.id)).toEqual(['r2', 'r1']);
  });

  it('excludes runs belonging to a different automation', () => {
    const cache: LibraryCache = { 'proj-a': { ...EMPTY_LIBRARY, runs: [run('r1', 'a1'), run('r2', 'a2')] } };
    expect(runsForAutomation(cache, 'a1').map((r) => r.id)).toEqual(['r1']);
  });
});

describe('mapEntries identity (exercised through the patch helpers)', () => {
  it('an unchanged cache returns the exact same reference, not a copy', () => {
    const cache: LibraryCache = { 'proj-a': { ...EMPTY_LIBRARY } };
    // No entry holds 'missing', so every entry's patch is a no-op.
    expect(removeDefinitionFromCache(cache, 'missing')).toBe(cache);
    expect(patchRunInCache(cache, run('r1', 'missing'))).toBe(cache);
  });
});
