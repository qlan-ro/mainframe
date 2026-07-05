import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers = new Set<(e: any) => void>();
vi.mock('@/lib/daemon/ws-client', () => ({
  daemonWs: {
    onEvent: (h: any) => {
      handlers.add(h);
      return () => handlers.delete(h);
    },
  },
}));

import {
  useAdaptersStore,
  seedAdapters,
  resetAdapters,
  resetRevisionBaseline,
  applyAdapterModels,
  installAdapterModelsSubscriber,
} from '../adapters.js';

const info = (id: string, rev: number, models: any[]) => ({
  id,
  name: id,
  description: '',
  installed: true,
  models,
  modelsRevision: rev,
  catalogSource: 'fallback' as const,
  capabilities: { planMode: true },
});

describe('ui adapters store', () => {
  beforeEach(() => {
    resetAdapters();
    handlers.clear();
  });

  it('resetRevisionBaseline keeps models visible but accepts a tied-revision seed', () => {
    seedAdapters([info('claude', 2, [{ id: 'a', label: 'A' }])]);
    resetRevisionBaseline();
    expect(useAdaptersStore.getState().byId.claude!.models[0]!.id).toBe('a'); // visible
    seedAdapters([info('claude', 2, [{ id: 'b', label: 'B' }])]); // tied rev 2
    expect(useAdaptersStore.getState().byId.claude!.models[0]!.id).toBe('b');
  });

  it('applies a WS update only when strictly newer', () => {
    seedAdapters([info('claude', 2, [{ id: 'a', label: 'A' }])]);
    const unsub = installAdapterModelsSubscriber();
    handlers.forEach((h) =>
      h({ type: 'adapter.models.updated', adapterId: 'claude', models: [{ id: 'x', label: 'X' }], modelsRevision: 1 }),
    );
    expect(useAdaptersStore.getState().byId.claude!.models[0]!.id).toBe('a'); // stale ignored
    handlers.forEach((h) =>
      h({ type: 'adapter.models.updated', adapterId: 'claude', models: [{ id: 'y', label: 'Y' }], modelsRevision: 3 }),
    );
    expect(useAdaptersStore.getState().byId.claude!.models[0]!.id).toBe('y');
    expect(useAdaptersStore.getState().byId.claude!.catalogSource).toBe('probed');
    unsub();
  });

  it('upserts a partial entry when the adapter is unknown (event before seed)', () => {
    applyAdapterModels('codex', [{ id: 'm', label: 'M' }], 4);
    expect(useAdaptersStore.getState().byId.codex!.models[0]!.id).toBe('m');
    seedAdapters([info('codex', 1, [{ id: 'old', label: 'O' }])]); // identity fills, newer models kept
    expect(useAdaptersStore.getState().byId.codex!.name).toBe('codex');
    expect(useAdaptersStore.getState().byId.codex!.models[0]!.id).toBe('m');
  });

  it('reset clears the store', () => {
    seedAdapters([info('claude', 1, [])]);
    resetAdapters();
    expect(Object.keys(useAdaptersStore.getState().byId)).toHaveLength(0);
  });
});
