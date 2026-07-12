import { beforeEach, describe, expect, it } from 'vitest';
import type { AutomationsGateway } from '../gateway';
import { useAutomationsStore } from '../use-automations-store';

function fakeGateway(overrides: Partial<AutomationsGateway> = {}): AutomationsGateway {
  return {
    listAutomations: async () => [],
    createAutomation: async () => {
      throw new Error('not implemented');
    },
    getAutomation: async () => {
      throw new Error('not implemented');
    },
    updateAutomation: async () => {
      throw new Error('not implemented');
    },
    deleteAutomation: async () => {},
    setEnabled: async () => {
      throw new Error('not implemented');
    },
    startRun: async () => {
      throw new Error('not implemented');
    },
    listRuns: async () => [],
    getRun: async () => {
      throw new Error('not implemented');
    },
    cancelRun: async () => {},
    listInteractions: async () => [],
    respondInteraction: async () => {},
    listActions: async () => [],
    listCredentialLabels: async () => [],
    putCredential: async () => {},
    deleteCredential: async () => {},
    ...overrides,
  };
}

describe('useAutomationsStore', () => {
  beforeEach(() => {
    useAutomationsStore.setState({
      definitions: [],
      runs: [],
      interactions: [],
      catalog: [],
      credentials: [],
      loading: false,
      error: null,
    });
  });

  it('defaults to a seeded fixture gateway (no network needed before Phase 6)', async () => {
    const definitions = await useAutomationsStore.getState().gateway.listAutomations();
    expect(definitions.length).toBe(6);
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
