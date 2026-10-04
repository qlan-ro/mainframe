import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeGateway as fakeGateway } from './fake-gateway';
import { useAutomationsStore, selectLibrary, selectAutomationById, selectRunById } from '../use-automations-store';
import { EMPTY_LIBRARY, type LibraryCache } from '../library-cache';

/**
 * D23: the automations library is a scope-keyed cache (`libraries`), one
 * entry per `projectId | 'all'`. These tests cover the cache-level guarantees
 * that only matter with TWO OR MORE scopes loaded: nothing evicts anything
 * else, patches land everywhere they belong, and a stale response for one
 * scope cannot clobber either a fresher load of that SAME scope or another
 * scope entirely.
 */

const defFixture = (id: string, projectId: string | null = null) => ({
  id,
  name: id,
  scope: (projectId == null ? 'global' : 'project') as 'global' | 'project',
  projectId,
  enabled: true,
  definition: { triggers: [], steps: [] },
  createdAt: 1,
  updatedAt: 1,
});

const runFixture = (id: string, automationId: string) => ({
  id,
  automationId,
  status: 'running' as const,
  trigger: { kind: 'manual' as const },
  startedAt: 1,
  finishedAt: null,
  error: null,
});

function seedLibraries(overrides: LibraryCache): void {
  useAutomationsStore.setState({ libraries: overrides });
}

beforeEach(() => {
  useAutomationsStore.setState({
    libraries: {},
    runRevisions: {},
    interactions: [],
    catalog: [],
    credentials: [],
    scopeProjectId: null,
  });
});

describe('two scopes loaded, neither evicts the other', () => {
  it('loading "proj-a" then null ("all") keeps both entries present', async () => {
    useAutomationsStore
      .getState()
      .setGateway(fakeGateway({ listAutomations: async (id) => [defFixture(id ?? 'global-def', id)] }));

    await useAutomationsStore.getState().loadLibrary('proj-a');
    await useAutomationsStore.getState().loadLibrary(null);

    const projA = selectLibrary('proj-a')(useAutomationsStore.getState());
    const all = selectLibrary('all')(useAutomationsStore.getState());
    expect(projA.definitions.map((d) => d.id)).toEqual(['proj-a']);
    expect(all.definitions.map((d) => d.id)).toEqual(['global-def']);
  });

  it('loading "all" first and then "proj-a" leaves "all" untouched', async () => {
    useAutomationsStore
      .getState()
      .setGateway(fakeGateway({ listAutomations: async (id) => [defFixture(id ?? 'global-def', id)] }));

    await useAutomationsStore.getState().loadLibrary(null);
    await useAutomationsStore.getState().loadLibrary('proj-a');

    expect(selectLibrary('all')(useAutomationsStore.getState()).definitions.map((d) => d.id)).toEqual(['global-def']);
    expect(selectLibrary('proj-a')(useAutomationsStore.getState()).definitions.map((d) => d.id)).toEqual(['proj-a']);
  });
});

describe('selectAutomationById resolves across every loaded scope', () => {
  it('finds an automation loaded under a scope other than the one passed in', () => {
    seedLibraries({
      'proj-a': { ...EMPTY_LIBRARY, definitions: [defFixture('a1', 'proj-a')] },
    });
    expect(selectAutomationById('a1')(useAutomationsStore.getState())?.id).toBe('a1');
  });

  it('returns undefined for an id no loaded scope holds', () => {
    seedLibraries({ 'proj-a': { ...EMPTY_LIBRARY, definitions: [defFixture('a1', 'proj-a')] } });
    expect(selectAutomationById('missing')(useAutomationsStore.getState())).toBeUndefined();
  });

  it('selectRunById resolves a run the same way, across scopes', () => {
    seedLibraries({
      'proj-a': { ...EMPTY_LIBRARY, definitions: [defFixture('a1', 'proj-a')], runs: [runFixture('r1', 'a1')] },
    });
    expect(selectRunById('r1')(useAutomationsStore.getState())?.id).toBe('r1');
  });
});

describe('patchDefinition across scopes', () => {
  it('a project-scoped definition appends to its own project entry and "all", not to another project\'s entry', () => {
    seedLibraries({
      'proj-a': { ...EMPTY_LIBRARY },
      'proj-b': { ...EMPTY_LIBRARY },
      all: { ...EMPTY_LIBRARY },
    });
    useAutomationsStore.getState().patchDefinition(defFixture('new-1', 'proj-a'));

    expect(selectLibrary('proj-a')(useAutomationsStore.getState()).definitions.map((d) => d.id)).toEqual(['new-1']);
    expect(selectLibrary('all')(useAutomationsStore.getState()).definitions.map((d) => d.id)).toEqual(['new-1']);
    expect(selectLibrary('proj-b')(useAutomationsStore.getState()).definitions).toEqual([]);
  });

  it('a global (projectId null) definition appends to EVERY loaded entry', () => {
    seedLibraries({
      'proj-a': { ...EMPTY_LIBRARY },
      'proj-b': { ...EMPTY_LIBRARY },
      all: { ...EMPTY_LIBRARY },
    });
    useAutomationsStore.getState().patchDefinition(defFixture('global-1', null));

    expect(selectLibrary('proj-a')(useAutomationsStore.getState()).definitions.map((d) => d.id)).toEqual(['global-1']);
    expect(selectLibrary('proj-b')(useAutomationsStore.getState()).definitions.map((d) => d.id)).toEqual(['global-1']);
    expect(selectLibrary('all')(useAutomationsStore.getState()).definitions.map((d) => d.id)).toEqual(['global-1']);
  });
});

describe('removeDefinition across scopes', () => {
  it('removes the definition from every entry that holds it', () => {
    const def = defFixture('a1', null);
    seedLibraries({
      'proj-a': { ...EMPTY_LIBRARY, definitions: [def] },
      all: { ...EMPTY_LIBRARY, definitions: [def] },
    });
    useAutomationsStore.getState().removeDefinition('a1');
    expect(selectLibrary('proj-a')(useAutomationsStore.getState()).definitions).toEqual([]);
    expect(selectLibrary('all')(useAutomationsStore.getState()).definitions).toEqual([]);
  });
});

describe('patchRun across scopes', () => {
  it('lands the run in every entry holding its automation, and bumps runRevisions exactly once', () => {
    const def = defFixture('a1', null);
    seedLibraries({
      'proj-a': { ...EMPTY_LIBRARY, definitions: [def] },
      all: { ...EMPTY_LIBRARY, definitions: [def] },
      'proj-b': { ...EMPTY_LIBRARY }, // does not hold a1 — must stay untouched
    });
    const run = runFixture('r1', 'a1');
    useAutomationsStore.getState().patchRun(run);

    expect(selectLibrary('proj-a')(useAutomationsStore.getState()).runs).toEqual([run]);
    expect(selectLibrary('all')(useAutomationsStore.getState()).runs).toEqual([run]);
    expect(selectLibrary('proj-b')(useAutomationsStore.getState()).runs).toEqual([]);
    expect(useAutomationsStore.getState().runRevisions.r1).toBe(1);
  });
});

describe('the per-scope stale-response guard', () => {
  it('a stale response for scope A never overwrites a newer load of A, and never touches scope B', async () => {
    let callsForA = 0;
    useAutomationsStore.getState().setGateway(
      fakeGateway({
        listAutomations: async (projectId) => {
          if (projectId === 'proj-a') {
            callsForA += 1;
            if (callsForA === 1) {
              await new Promise((resolve) => setTimeout(resolve, 20));
              return [defFixture('stale', 'proj-a')];
            }
            return [defFixture('fresh', 'proj-a')];
          }
          return [defFixture('b-def', projectId)];
        },
      }),
    );

    const staleA = useAutomationsStore.getState().loadLibrary('proj-a');
    const freshA = useAutomationsStore.getState().loadLibrary('proj-a');
    const b = useAutomationsStore.getState().loadLibrary('proj-b');
    await Promise.all([staleA, freshA, b]);

    expect(selectLibrary('proj-a')(useAutomationsStore.getState()).definitions.map((d) => d.id)).toEqual(['fresh']);
    expect(selectLibrary('proj-b')(useAutomationsStore.getState()).definitions.map((d) => d.id)).toEqual(['b-def']);
  });
});
