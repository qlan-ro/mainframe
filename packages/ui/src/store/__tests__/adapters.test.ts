// @vitest-environment jsdom
/**
 * store/adapters.test.ts — the shared adapter catalog store.
 *
 * Includes a regression suite for `useAdapters()` referential stability
 * (React error #185 root cause): `Object.values(byId)` allocates a NEW array
 * on every call once the catalog is non-empty, so any consumer that puts the
 * return value in a `useEffect`/`useMemo` dependency array sees a "changed"
 * dependency on every render, even when nothing in the catalog actually
 * changed. Verified with `renderHook` by asserting reference identity
 * (`toBe`/`not.toBe`) across re-renders, not by recomputing the contents.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

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
  useAdapters,
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

// ---------------------------------------------------------------------------
// useAdapters() referential stability (React error #185 regression).
//
// A consumer that lists useAdapters()'s return value in a useEffect/useMemo
// dependency array relies on it being the SAME array reference across
// re-renders when the catalog hasn't changed. If it isn't, the dependency
// looks "changed" on every render, and any effect using it as a dep tears
// down and reruns unconditionally.
// ---------------------------------------------------------------------------

describe('useAdapters — referential stability', () => {
  beforeEach(() => {
    resetAdapters();
  });

  it('returns a referentially stable array across re-renders when the catalog is unchanged', () => {
    seedAdapters([info('claude', 1, [])]);

    const { result, rerender } = renderHook(() => useAdapters());
    const first = result.current;
    rerender();

    expect(result.current).toBe(first);
    expect(result.current.map((a) => a.id)).toEqual(['claude']);
  });

  it('returns a new array reference after seedAdapters adds an adapter', () => {
    seedAdapters([info('claude', 1, [])]);

    const { result, rerender } = renderHook(() => useAdapters());
    const first = result.current;
    seedAdapters([info('codex', 1, [])]);
    rerender();

    expect(result.current).not.toBe(first);
    expect(result.current.map((a) => a.id).sort()).toEqual(['claude', 'codex']);
  });

  it('returns a new array reference after applyAdapterModels updates the catalog', () => {
    seedAdapters([info('claude', 1, [{ id: 'a', label: 'A' }])]);

    const { result, rerender } = renderHook(() => useAdapters());
    const first = result.current;
    applyAdapterModels('claude', [{ id: 'b', label: 'B' }], 2);
    rerender();

    expect(result.current).not.toBe(first);
    expect(result.current.map((a) => a.id)).toEqual(['claude']);
  });

  it('returns the same EMPTY-catalog reference across re-renders when there are no adapters', () => {
    const { result, rerender } = renderHook(() => useAdapters());
    const first = result.current;
    rerender();

    expect(result.current).toBe(first);
    expect(result.current).toEqual([]);
  });
});
