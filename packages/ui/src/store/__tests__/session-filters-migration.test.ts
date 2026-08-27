/**
 * session-filters — module-init localStorage read + the one-shot
 * filterProjectId → filterProjectIds migration, split out of
 * session-filters.test.ts because both need a fresh module per case
 * (vi.resetModules() + dynamic import), unlike the rest of the store's tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActiveDaemon } from '@/lib/daemon/active-daemon';

const NEW_SCOPED_KEY = 'mf:filterProjectIds::local';
const OLD_SCOPED_KEY = 'mf:filterProjectId::local';

beforeEach(() => {
  setActiveDaemon({ id: 'local', kind: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:0', token: null });
  localStorage.removeItem(NEW_SCOPED_KEY);
  localStorage.removeItem(OLD_SCOPED_KEY);
});

describe('session-filters — initial filterProjectIds reads the new key on module import', () => {
  it('initialises from a JSON array seeded in localStorage before module load', async () => {
    localStorage.setItem(NEW_SCOPED_KEY, '["proj-seed-a","proj-seed-b"]');
    vi.resetModules();

    const { useSessionFilters: freshStore } = await import('../session-filters');

    expect(freshStore.getState().filterProjectIds).toEqual(new Set(['proj-seed-a', 'proj-seed-b']));
  });

  it('initialises to an empty set when neither key is present', async () => {
    vi.resetModules();

    const { useSessionFilters: freshStore } = await import('../session-filters');

    expect(freshStore.getState().filterProjectIds).toEqual(new Set());
  });
});

describe('session-filters — one-shot migration from the old singular key', () => {
  it('seeds the set from the old plain-string key, writes the new key, and removes the old key', async () => {
    localStorage.setItem(OLD_SCOPED_KEY, 'proj-legacy');
    vi.resetModules();

    const { useSessionFilters: freshStore } = await import('../session-filters');

    expect(freshStore.getState().filterProjectIds).toEqual(new Set(['proj-legacy']));
    expect(localStorage.getItem(NEW_SCOPED_KEY)).toBe('["proj-legacy"]');
    expect(localStorage.getItem(OLD_SCOPED_KEY)).toBeNull();
  });

  it('does not run the migration when the new key is already present', async () => {
    localStorage.setItem(NEW_SCOPED_KEY, '["proj-current"]');
    localStorage.setItem(OLD_SCOPED_KEY, 'proj-legacy');
    vi.resetModules();

    const { useSessionFilters: freshStore } = await import('../session-filters');

    expect(freshStore.getState().filterProjectIds).toEqual(new Set(['proj-current']));
  });

  it('does nothing when neither key is present (no migration, no crash)', async () => {
    vi.resetModules();

    const { useSessionFilters: freshStore } = await import('../session-filters');

    expect(freshStore.getState().filterProjectIds).toEqual(new Set());
    expect(localStorage.getItem(NEW_SCOPED_KEY)).toBeNull();
  });
});
