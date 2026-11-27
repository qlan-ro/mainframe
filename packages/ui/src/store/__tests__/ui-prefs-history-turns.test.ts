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

it('loads 10 turns at a time on a clean install', async () => {
  expect((await reloadStore()).getState().historyTurns).toBe(10);
});

it('keeps the count across a fresh module', async () => {
  const store = await reloadStore();
  store.getState().setHistoryTurns(24);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).state.historyTurns).toBe(24);
  expect((await reloadStore()).getState().historyTurns).toBe(24);
});

it.each([
  [0, 2],
  [1, 2],
  [51, 50],
  [7.6, 8],
  [Number.NaN, 10],
])('clamps %j to %j', async (value, expected) => {
  const store = await reloadStore();
  store.getState().setHistoryTurns(value);
  expect(store.getState().historyTurns).toBe(expected);
});

it.each([['many'], [null], [Number.POSITIVE_INFINITY]])('reads a stored %j as the default', async (stored) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { historyTurns: stored }, version: 9 }));
  expect((await reloadStore()).getState().historyTurns).toBe(10);
});

it('clamps a stored count outside the bounds', async () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: { historyTurns: 400 }, version: 9 }));
  expect((await reloadStore()).getState().historyTurns).toBe(50);
});
