// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'mf:ui-prefs';

async function reloadStore() {
  vi.resetModules();
  const { useUiPrefs } = await import('../ui-prefs');
  await useUiPrefs.persist.rehydrate();
  return useUiPrefs;
}

beforeEach(() => localStorage.clear());

it('starts with chips off on a clean install', async () => {
  const store = await reloadStore();
  expect(store.getState().chipComposer).toBe(false);
});

it('keeps chips on across a fresh module once turned on', async () => {
  const store = await reloadStore();
  store.getState().setChipComposer(true);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).state.chipComposer).toBe(true);
  expect((await reloadStore()).getState().chipComposer).toBe(true);
});

it.each([['yes'], [1], [null]])('reads a stored %j as off', async (stored) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { chipComposer: stored }, version: 9 }));
  expect((await reloadStore()).getState().chipComposer).toBe(false);
});
