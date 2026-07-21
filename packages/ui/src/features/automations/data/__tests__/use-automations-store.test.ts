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
      activeProjectId: null,
    });
  });

  it('defaults to a seeded fixture gateway (no network needed)', async () => {
    const definitions = await useAutomationsStore.getState().gateway.listAutomations();
    expect(definitions.length).toBe(6);
  });

  it('setActiveProjectId updates the field', () => {
    useAutomationsStore.getState().setActiveProjectId('proj-9');
    expect(useAutomationsStore.getState().activeProjectId).toBe('proj-9');
  });

  it('loadAll passes the active projectId through to gateway.listAutomations', async () => {
    let received: string | null | undefined = 'unset';
    useAutomationsStore.getState().setActiveProjectId('proj-9');
    useAutomationsStore.getState().setGateway(
      fakeGateway({
        listAutomations: async (projectId) => {
          received = projectId;
          return [];
        },
      }),
    );

    await useAutomationsStore.getState().loadAll();

    expect(received).toBe('proj-9');
  });

  it('loadAll populates definitions/interactions/catalog/credentials/runs from the gateway', async () => {
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

    await useAutomationsStore.getState().loadAll();

    const state = useAutomationsStore.getState();
    expect(state.definitions).toHaveLength(1);
    expect(state.runs).toHaveLength(1);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('loadAll sets error on gateway failure', async () => {
    useAutomationsStore.getState().setGateway(
      fakeGateway({
        listAutomations: async () => {
          throw new Error('boom');
        },
      }),
    );

    await useAutomationsStore.getState().loadAll();

    expect(useAutomationsStore.getState().error).toBe('boom');
    expect(useAutomationsStore.getState().loading).toBe(false);
  });

  it('loadAll surfaces a run-history fetch failure via the error field instead of silently rendering an empty history', async () => {
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

    await useAutomationsStore.getState().loadAll();

    const state = useAutomationsStore.getState();
    expect(state.definitions).toHaveLength(1);
    expect(state.loading).toBe(false);
    expect(state.error).toBe('run history unavailable');
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
