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

it('starts with today’s transcript list on a clean install', async () => {
  expect((await reloadStore()).getState().plainTranscript).toBe(false);
});

it('keeps the plain list once turned on', async () => {
  const store = await reloadStore();
  store.getState().setPlainTranscript(true);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).state.plainTranscript).toBe(true);
  expect((await reloadStore()).getState().plainTranscript).toBe(true);
});

it.each([['yes'], [1], [null]])('reads a stored %j as off', async (stored) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { plainTranscript: stored }, version: 9 }));
  expect((await reloadStore()).getState().plainTranscript).toBe(false);
});
