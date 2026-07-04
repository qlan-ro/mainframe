import { describe, it, expect, beforeEach } from 'vitest';
import { useAdaptersStore } from '../adapters.js';
import type { AdapterInfo } from '@qlan-ro/mainframe-types';

const info = (id: string, rev: number, models: any[], installed = true): AdapterInfo => ({
  id,
  name: id,
  description: '',
  installed,
  version: '1',
  models,
  modelsRevision: rev,
  catalogSource: 'fallback',
  capabilities: { planMode: true },
});

describe('desktop adapters store', () => {
  beforeEach(() => useAdaptersStore.getState().resetAdapters());

  it('setAdapters refreshes identity but keeps newer models', () => {
    useAdaptersStore.getState().updateAdapterModels('claude', [{ id: 'live', label: 'L' }], 5); // partial, rev5
    useAdaptersStore.getState().setAdapters([info('claude', 2, [{ id: 'old', label: 'O' }])]); // identity+rev2
    const a = useAdaptersStore.getState().adapters.find((x) => x.id === 'claude')!;
    expect(a.name).toBe('claude'); // identity applied
    expect(a.models[0]!.id).toBe('live'); // newer models kept
    expect(a.modelsRevision).toBe(5);
  });

  it('updateAdapterModels upserts a partial entry when the adapter is unknown', () => {
    useAdaptersStore.getState().updateAdapterModels('codex', [{ id: 'm', label: 'M' }], 3);
    expect(useAdaptersStore.getState().adapters.find((x) => x.id === 'codex')?.models[0]!.id).toBe('m');
  });

  it('resetRevisionBaseline keeps models visible but accepts a tied-revision snapshot', () => {
    useAdaptersStore.getState().setAdapters([info('claude', 2, [{ id: 'a', label: 'A' }])]);
    useAdaptersStore.getState().resetRevisionBaseline();
    const mid = useAdaptersStore.getState().adapters.find((x) => x.id === 'claude')!;
    expect(mid.models[0]!.id).toBe('a'); // still visible
    expect(mid.modelsRevision).toBeUndefined(); // baseline dropped
    useAdaptersStore.getState().setAdapters([info('claude', 2, [{ id: 'b', label: 'B' }])]); // tied rev 2
    expect(useAdaptersStore.getState().adapters.find((x) => x.id === 'claude')!.models[0]!.id).toBe('b');
  });

  it('resetAdapters clears the store (daemon switch only)', () => {
    useAdaptersStore.getState().setAdapters([info('claude', 1, [])]);
    useAdaptersStore.getState().resetAdapters();
    expect(useAdaptersStore.getState().adapters).toHaveLength(0);
  });
});
