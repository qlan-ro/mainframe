import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeGateway as fakeGateway } from './fake-gateway';
import { useAutomationsStore, selectLibrary, selectModalLibrary } from '../use-automations-store';
import { EMPTY_LIBRARY, type LibraryCache } from '../library-cache';

/**
 * D23: the single library slot became a scope-keyed cache (`libraries`).
 * `loadLibrary(null)` fills the `'all'` entry; `scopeProjectId` stays null in
 * these cases, so `selectModalLibrary` also reads `'all'`. The cross-scope
 * cache guarantees (two scopes coexisting, cross-scope lookups, the
 * per-scope stale guard) live in use-automations-store.scopes.test.ts.
 */

const defFixture = (id: string) => ({
  id,
  name: id,
  scope: 'global' as const,
  projectId: null,
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

/** Seed one scope with a non-empty entry so the patch helpers (which only
 *  ever touch EXISTING entries) have something to land in. */
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

describe('useAutomationsStore', () => {
  it('defaults to a seeded fixture gateway (no network needed)', async () => {
    const definitions = await useAutomationsStore.getState().gateway.listAutomations();
    expect(definitions.length).toBe(7);
  });

  it('setScopeProjectId updates the field', () => {
    useAutomationsStore.getState().setScopeProjectId('proj-9');
    expect(useAutomationsStore.getState().scopeProjectId).toBe('proj-9');
  });

  it('loadLibrary passes the project it is given to gateway.listAutomations, without reading the store', async () => {
    let received: string | null | undefined = 'unset';
    useAutomationsStore.getState().setGateway(
      fakeGateway({
        listAutomations: async (projectId) => {
          received = projectId;
          return [];
        },
      }),
    );

    await useAutomationsStore.getState().loadLibrary('proj-9');

    expect(received).toBe('proj-9');
    expect(useAutomationsStore.getState().scopeProjectId).toBeNull();
  });

  it('loadLibrary(null) populates the "all" scope\'s definitions/catalog/credentials/runs', async () => {
    useAutomationsStore.getState().setGateway(
      fakeGateway({
        listAutomations: async () => [defFixture('a1')],
        listRuns: async (id) => [runFixture('r1', id)],
      }),
    );

    await useAutomationsStore.getState().loadLibrary(null);

    const entry = selectModalLibrary(useAutomationsStore.getState());
    expect(entry.definitions).toHaveLength(1);
    expect(entry.runs).toHaveLength(1);
    expect(entry.loading).toBe(false);
    expect(entry.error).toBeNull();
  });

  it("loadLibrary sets the scope entry's error on gateway failure", async () => {
    useAutomationsStore.getState().setGateway(
      fakeGateway({
        listAutomations: async () => {
          throw new Error('boom');
        },
      }),
    );

    await useAutomationsStore.getState().loadLibrary(null);

    expect(selectLibrary('all')(useAutomationsStore.getState()).error).toBe('boom');
    expect(selectLibrary('all')(useAutomationsStore.getState()).loading).toBe(false);
  });

  it('loadLibrary surfaces a run-history fetch failure via the error field instead of silently rendering an empty history', async () => {
    useAutomationsStore.getState().setGateway(
      fakeGateway({
        listAutomations: async () => [defFixture('a1')],
        listRuns: async () => {
          throw new Error('run history unavailable');
        },
      }),
    );

    await useAutomationsStore.getState().loadLibrary(null);

    const entry = selectLibrary('all')(useAutomationsStore.getState());
    expect(entry.definitions).toHaveLength(1);
    expect(entry.loading).toBe(false);
    expect(entry.error).toBe('run history unavailable');
  });

  it('loadInteractions fills the badge without touching any library entry', async () => {
    useAutomationsStore.getState().setGateway(
      fakeGateway({
        listInteractions: async () => [
          {
            id: 'i1',
            runId: 'r1',
            stepRef: 's1',
            title: 'Answer',
            fields: [],
            status: 'pending' as const,
            createdAt: 1,
            resolvedAt: null,
          },
        ],
        listAutomations: async () => {
          throw new Error('the badge load must not fetch definitions');
        },
      }),
    );

    await useAutomationsStore.getState().loadInteractions();

    const state = useAutomationsStore.getState();
    expect(state.interactions).toHaveLength(1);
    expect(state.libraries).toEqual({});
  });

  it('loadLibrary, retried for the SAME scope, drops a slow first response once a fresher one for that scope lands', async () => {
    let call = 0;
    useAutomationsStore.getState().setGateway(
      fakeGateway({
        listAutomations: async () => {
          call += 1;
          if (call === 1) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return [defFixture('stale')];
          }
          return [defFixture('fresh')];
        },
      }),
    );

    const stale = useAutomationsStore.getState().loadLibrary('proj-a');
    await useAutomationsStore.getState().loadLibrary('proj-a');
    await stale;

    expect(selectLibrary('proj-a')(useAutomationsStore.getState()).definitions.map((d) => d.id)).toEqual(['fresh']);
  });

  it('loadLibrary keeps the previous rows on screen when retried for the same project', async () => {
    useAutomationsStore
      .getState()
      .setGateway(fakeGateway({ listAutomations: async (id) => [defFixture(id ?? 'none')] }));
    await useAutomationsStore.getState().loadLibrary('proj-a');
    expect(selectLibrary('proj-a')(useAutomationsStore.getState()).definitions.map((d) => d.id)).toEqual(['proj-a']);

    let clearedDuringRetry = false;
    useAutomationsStore.getState().setGateway(
      fakeGateway({
        listAutomations: async () => {
          clearedDuringRetry = selectLibrary('proj-a')(useAutomationsStore.getState()).definitions.length === 0;
          throw new Error('retry boom');
        },
      }),
    );
    await useAutomationsStore.getState().loadLibrary('proj-a');

    expect(clearedDuringRetry).toBe(false);
    expect(selectLibrary('proj-a')(useAutomationsStore.getState()).definitions.map((d) => d.id)).toEqual(['proj-a']);
  });

  it('loadInteractions drops a slow response overtaken by a newer one', async () => {
    const interactionFor = (id: string) => ({
      id,
      runId: 'r1',
      stepRef: 's1',
      title: id,
      fields: [],
      status: 'pending' as const,
      createdAt: 1,
      resolvedAt: null,
    });
    let call = 0;
    useAutomationsStore.getState().setGateway(
      fakeGateway({
        listInteractions: async () => {
          call += 1;
          if (call === 1) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return [interactionFor('stale')];
          }
          return [interactionFor('fresh')];
        },
      }),
    );

    const stale = useAutomationsStore.getState().loadInteractions();
    await useAutomationsStore.getState().loadInteractions();
    await stale;

    expect(useAutomationsStore.getState().interactions.map((i) => i.id)).toEqual(['fresh']);
  });

  it('patchDefinition upserts by id within an already-loaded scope', () => {
    seedLibraries({ all: { ...EMPTY_LIBRARY } });
    const def = defFixture('a1');
    useAutomationsStore.getState().patchDefinition(def);
    expect(selectLibrary('all')(useAutomationsStore.getState()).definitions).toEqual([def]);
    const updated = { ...def, name: 'A renamed' };
    useAutomationsStore.getState().patchDefinition(updated);
    expect(selectLibrary('all')(useAutomationsStore.getState()).definitions).toEqual([updated]);
  });

  it('removeDefinition drops it by id', () => {
    const def = defFixture('a1');
    seedLibraries({ all: { ...EMPTY_LIBRARY, definitions: [def] } });
    useAutomationsStore.getState().removeDefinition('a1');
    expect(selectLibrary('all')(useAutomationsStore.getState()).definitions).toEqual([]);
  });

  it('patchRun upserts by id in the entry that holds its automation', () => {
    seedLibraries({ all: { ...EMPTY_LIBRARY, definitions: [defFixture('a1')] } });
    const run = runFixture('r1', 'a1');
    useAutomationsStore.getState().patchRun(run);
    expect(selectLibrary('all')(useAutomationsStore.getState()).runs).toEqual([run]);
    const done = { ...run, status: 'succeeded' as const };
    useAutomationsStore.getState().patchRun(done);
    expect(selectLibrary('all')(useAutomationsStore.getState()).runs).toEqual([done]);
  });

  it('patchRun never regresses a terminal run to a non-terminal status', () => {
    // Race seen live: a 2ms run's WS `succeeded` event lands before the 202
    // response resolves, then patchRun(202-body{running}) clobbered it and the
    // run view stayed "Running" forever (no later event ever fixes it).
    seedLibraries({ all: { ...EMPTY_LIBRARY, definitions: [defFixture('a1')] } });
    const done = { ...runFixture('r1', 'a1'), status: 'succeeded' as const, finishedAt: 3 };
    useAutomationsStore.getState().patchRun(done);
    const stale = { ...done, status: 'running' as const, finishedAt: null };
    useAutomationsStore.getState().patchRun(stale);
    expect(selectLibrary('all')(useAutomationsStore.getState()).runs).toEqual([done]);

    // A terminal→terminal update (e.g. failed details enriched) still applies.
    const failed = { ...done, status: 'failed' as const, error: 'boom' };
    useAutomationsStore.getState().patchRun(failed);
    expect(selectLibrary('all')(useAutomationsStore.getState()).runs).toEqual([failed]);
  });

  it('patchRun bumps the run’s revision counter on every applied update, even with an unchanged status', () => {
    seedLibraries({ all: { ...EMPTY_LIBRARY, definitions: [defFixture('a1')] } });
    const run = runFixture('r1', 'a1');
    useAutomationsStore.getState().patchRun(run);
    expect(useAutomationsStore.getState().runRevisions.r1).toBe(1);
    useAutomationsStore.getState().patchRun({ ...run });
    expect(useAutomationsStore.getState().runRevisions.r1).toBe(2);
  });

  it('patchRun does not bump the revision counter when the terminal-status guard rejects the update', () => {
    seedLibraries({ all: { ...EMPTY_LIBRARY, definitions: [defFixture('a1')] } });
    const done = { ...runFixture('r1', 'a1'), status: 'succeeded' as const, finishedAt: 3 };
    useAutomationsStore.getState().patchRun(done);
    expect(useAutomationsStore.getState().runRevisions.r1).toBe(1);
    const stale = { ...done, status: 'running' as const, finishedAt: null };
    useAutomationsStore.getState().patchRun(stale);
    expect(useAutomationsStore.getState().runRevisions.r1).toBe(1);
  });

  it('addCredential dedupes by label; removeCredential drops it', () => {
    useAutomationsStore.getState().addCredential('GitHub');
    useAutomationsStore.getState().addCredential('GitHub');
    expect(useAutomationsStore.getState().credentials).toEqual(['GitHub']);
    useAutomationsStore.getState().addCredential('Notion');
    expect(useAutomationsStore.getState().credentials).toEqual(['GitHub', 'Notion']);
    useAutomationsStore.getState().removeCredential('GitHub');
    expect(useAutomationsStore.getState().credentials).toEqual(['Notion']);
  });

  it('addInteraction dedupes by id; resolveInteraction removes it', () => {
    const interaction = {
      id: 'i1',
      runId: 'r1',
      stepRef: 's1',
      title: 'Answer',
      fields: [],
      status: 'pending' as const,
      createdAt: 1,
      resolvedAt: null,
    };
    useAutomationsStore.getState().addInteraction(interaction);
    useAutomationsStore.getState().addInteraction(interaction);
    expect(useAutomationsStore.getState().interactions).toHaveLength(1);
    useAutomationsStore.getState().resolveInteraction('i1');
    expect(useAutomationsStore.getState().interactions).toHaveLength(0);
  });
});
