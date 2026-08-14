import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeGateway as fakeGateway } from './fake-gateway';
import { useAutomationsStore } from '../use-automations-store';

describe('useAutomationsStore', () => {
  beforeEach(() => {
    useAutomationsStore.setState({
      definitions: [],
      runs: [],
      runRevisions: {},
      interactions: [],
      catalog: [],
      credentials: [],
      loading: false,
      error: null,
      scopeProjectId: null,
    });
  });

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

  it('loadLibrary populates definitions/catalog/credentials/runs from the gateway', async () => {
    useAutomationsStore.getState().setGateway(
      fakeGateway({
        listAutomations: async () => [
          {
            id: 'a1',
            name: 'A',
            scope: 'global',
            projectId: null,
            enabled: true,
            definition: { triggers: [], steps: [] },
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        listRuns: async (id) => [
          {
            id: 'r1',
            automationId: id,
            status: 'running',
            trigger: { kind: 'manual' },
            startedAt: 2,
            finishedAt: null,
            error: null,
          },
        ],
      }),
    );

    await useAutomationsStore.getState().loadLibrary(null);

    const state = useAutomationsStore.getState();
    expect(state.definitions).toHaveLength(1);
    expect(state.runs).toHaveLength(1);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('loadLibrary sets error on gateway failure', async () => {
    useAutomationsStore.getState().setGateway(
      fakeGateway({
        listAutomations: async () => {
          throw new Error('boom');
        },
      }),
    );

    await useAutomationsStore.getState().loadLibrary(null);

    expect(useAutomationsStore.getState().error).toBe('boom');
    expect(useAutomationsStore.getState().loading).toBe(false);
  });

  it('loadLibrary surfaces a run-history fetch failure via the error field instead of silently rendering an empty history', async () => {
    useAutomationsStore.getState().setGateway(
      fakeGateway({
        listAutomations: async () => [
          {
            id: 'a1',
            name: 'A',
            scope: 'global',
            projectId: null,
            enabled: true,
            definition: { triggers: [], steps: [] },
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        listRuns: async () => {
          throw new Error('run history unavailable');
        },
      }),
    );

    await useAutomationsStore.getState().loadLibrary(null);

    const state = useAutomationsStore.getState();
    expect(state.definitions).toHaveLength(1);
    expect(state.loading).toBe(false);
    expect(state.error).toBe('run history unavailable');
  });

  it('loadInteractions fills the badge without touching the library', async () => {
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
    expect(state.definitions).toEqual([]);
    expect(state.error).toBeNull();
  });

  it('loadLibrary drops a slow response for a project the user has already moved off', async () => {
    const definitionFor = (id: string) => ({
      id,
      name: id,
      scope: 'global' as const,
      projectId: null,
      enabled: true,
      definition: { triggers: [], steps: [] },
      createdAt: 1,
      updatedAt: 1,
    });
    useAutomationsStore.getState().setGateway(
      fakeGateway({
        listAutomations: async (projectId) => {
          if (projectId === 'slow') await new Promise((resolve) => setTimeout(resolve, 20));
          return [definitionFor(projectId ?? 'none')];
        },
      }),
    );

    const stale = useAutomationsStore.getState().loadLibrary('slow');
    await useAutomationsStore.getState().loadLibrary('fresh');
    await stale;

    expect(useAutomationsStore.getState().definitions.map((d) => d.id)).toEqual(['fresh']);
  });

  it('loadLibrary clears the previous project’s rows as soon as it is called for a different project', async () => {
    const definitionFor = (id: string) => ({
      id,
      name: id,
      scope: 'global' as const,
      projectId: null,
      enabled: true,
      definition: { triggers: [], steps: [] },
      createdAt: 1,
      updatedAt: 1,
    });
    useAutomationsStore
      .getState()
      .setGateway(fakeGateway({ listAutomations: async (id) => [definitionFor(id ?? 'none')] }));
    await useAutomationsStore.getState().loadLibrary('proj-a');
    expect(useAutomationsStore.getState().definitions.map((d) => d.id)).toEqual(['proj-a']);

    // A stale row must be gone before the new project's fetch even resolves —
    // otherwise it stays clickable, and the editor it opens can save back into
    // the new project (finding: todo #326 review).
    let clearedDuringFetch = false;
    useAutomationsStore.getState().setGateway(
      fakeGateway({
        listAutomations: async (id) => {
          clearedDuringFetch = useAutomationsStore.getState().definitions.length === 0;
          return [definitionFor(id ?? 'none')];
        },
      }),
    );
    await useAutomationsStore.getState().loadLibrary('proj-b');

    expect(clearedDuringFetch).toBe(true);
    expect(useAutomationsStore.getState().definitions.map((d) => d.id)).toEqual(['proj-b']);
  });

  it('loadLibrary keeps the previous rows on screen when retried for the same project', async () => {
    const definitionFor = (id: string) => ({
      id,
      name: id,
      scope: 'global' as const,
      projectId: null,
      enabled: true,
      definition: { triggers: [], steps: [] },
      createdAt: 1,
      updatedAt: 1,
    });
    useAutomationsStore
      .getState()
      .setGateway(fakeGateway({ listAutomations: async (id) => [definitionFor(id ?? 'none')] }));
    await useAutomationsStore.getState().loadLibrary('proj-a');
    expect(useAutomationsStore.getState().definitions.map((d) => d.id)).toEqual(['proj-a']);

    let clearedDuringRetry = false;
    useAutomationsStore.getState().setGateway(
      fakeGateway({
        listAutomations: async () => {
          clearedDuringRetry = useAutomationsStore.getState().definitions.length === 0;
          throw new Error('retry boom');
        },
      }),
    );
    await useAutomationsStore.getState().loadLibrary('proj-a');

    expect(clearedDuringRetry).toBe(false);
    expect(useAutomationsStore.getState().definitions.map((d) => d.id)).toEqual(['proj-a']);
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

  it('patchDefinition upserts by id', () => {
    const def = {
      id: 'a1',
      name: 'A',
      scope: 'global' as const,
      projectId: null,
      enabled: true,
      definition: { triggers: [], steps: [] },
      createdAt: 1,
      updatedAt: 1,
    };
    useAutomationsStore.getState().patchDefinition(def);
    expect(useAutomationsStore.getState().definitions).toEqual([def]);
    const updated = { ...def, name: 'A renamed' };
    useAutomationsStore.getState().patchDefinition(updated);
    expect(useAutomationsStore.getState().definitions).toEqual([updated]);
  });

  it('removeDefinition drops it by id', () => {
    const def = {
      id: 'a1',
      name: 'A',
      scope: 'global' as const,
      projectId: null,
      enabled: true,
      definition: { triggers: [], steps: [] },
      createdAt: 1,
      updatedAt: 1,
    };
    useAutomationsStore.setState({ definitions: [def] });
    useAutomationsStore.getState().removeDefinition('a1');
    expect(useAutomationsStore.getState().definitions).toEqual([]);
  });

  it('patchRun upserts by id', () => {
    const run = {
      id: 'r1',
      automationId: 'a1',
      status: 'running' as const,
      trigger: { kind: 'manual' as const },
      startedAt: 1,
      finishedAt: null,
      error: null,
    };
    useAutomationsStore.getState().patchRun(run);
    expect(useAutomationsStore.getState().runs).toEqual([run]);
    const done = { ...run, status: 'succeeded' as const };
    useAutomationsStore.getState().patchRun(done);
    expect(useAutomationsStore.getState().runs).toEqual([done]);
  });

  it('patchRun never regresses a terminal run to a non-terminal status', () => {
    // Race seen live: a 2ms run's WS `succeeded` event lands before the 202
    // response resolves, then patchRun(202-body{running}) clobbered it and the
    // run view stayed "Running" forever (no later event ever fixes it).
    const done = {
      id: 'r1',
      automationId: 'a1',
      status: 'succeeded' as const,
      trigger: { kind: 'manual' as const },
      startedAt: 1,
      finishedAt: 3,
      error: null,
    };
    useAutomationsStore.getState().patchRun(done);
    const stale = { ...done, status: 'running' as const, finishedAt: null };
    useAutomationsStore.getState().patchRun(stale);
    expect(useAutomationsStore.getState().runs).toEqual([done]);

    // A terminal→terminal update (e.g. failed details enriched) still applies.
    const failed = { ...done, status: 'failed' as const, error: 'boom' };
    useAutomationsStore.getState().patchRun(failed);
    expect(useAutomationsStore.getState().runs).toEqual([failed]);
  });

  it('patchRun bumps the run’s revision counter on every applied update, even with an unchanged status', () => {
    const run = {
      id: 'r1',
      automationId: 'a1',
      status: 'running' as const,
      trigger: { kind: 'manual' as const },
      startedAt: 1,
      finishedAt: null,
      error: null,
    };
    useAutomationsStore.getState().patchRun(run);
    expect(useAutomationsStore.getState().runRevisions.r1).toBe(1);
    useAutomationsStore.getState().patchRun({ ...run });
    expect(useAutomationsStore.getState().runRevisions.r1).toBe(2);
  });

  it('patchRun does not bump the revision counter when the terminal-status guard rejects the update', () => {
    const done = {
      id: 'r1',
      automationId: 'a1',
      status: 'succeeded' as const,
      trigger: { kind: 'manual' as const },
      startedAt: 1,
      finishedAt: 3,
      error: null,
    };
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
