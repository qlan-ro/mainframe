import { describe, it, expect, vi, beforeEach } from 'vitest';

let resolvers: Array<(v: any) => void> = [];
vi.mock('@/lib/api/adapters', () => ({ getAdapters: vi.fn(() => new Promise((r) => resolvers.push(r))) }));
vi.mock('@/lib/daemon/ws-client', () => ({ daemonWs: { onEvent: () => () => {} } }));

import { useAdaptersStore, resetAdapters } from '../adapters.js';
import { seedAdaptersFor, invalidateSeedFetches } from '../adapters-seed.js';

const info = (id: string) => ({
  id,
  name: id,
  description: '',
  installed: true,
  models: [],
  modelsRevision: 1,
  catalogSource: 'fallback',
  capabilities: { planMode: true },
});

describe('seedAdaptersFor generation guard', () => {
  beforeEach(() => {
    resetAdapters();
    resolvers = [];
  });

  it('discards a superseded in-flight seed fetch', async () => {
    seedAdaptersFor(31415); // gen 1
    seedAdaptersFor(31500); // gen 2 supersedes
    resolvers[1]!([info('codex')]); // newer resolves first
    resolvers[0]!([info('claude')]); // older resolves late — must be ignored
    await Promise.resolve();
    await Promise.resolve();
    expect(Object.keys(useAdaptersStore.getState().byId)).toEqual(['codex']);
  });

  it('invalidateSeedFetches (daemon switch) discards a stale in-flight fetch', async () => {
    seedAdaptersFor(31415); // gen 1, fetch in flight
    invalidateSeedFetches(); // switch bumps generation
    resolvers[0]!([info('claude')]); // old fetch resolves — must be ignored
    await Promise.resolve();
    await Promise.resolve();
    expect(Object.keys(useAdaptersStore.getState().byId)).toHaveLength(0);
  });
});
