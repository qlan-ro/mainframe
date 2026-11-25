// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { useKeybindingsStore, type Overrides } from '../keybindings-store';

const storageKey = 'mf:keybindings';
const customChord = { code: 'KeyY', mod: true, shift: true };

async function loadLegacyOverrides(overrides: Overrides) {
  localStorage.setItem(storageKey, JSON.stringify({ state: { overrides }, version: 0 }));
  await useKeybindingsStore.persist.rehydrate();
  return useKeybindingsStore.getState().overrides;
}

afterEach(() => {
  useKeybindingsStore.getState().resetAll();
  localStorage.removeItem(storageKey);
});

describe('legacy split shortcuts', () => {
  it('persists a custom chord and an unassigned override under the new IDs', async () => {
    const expected = {
      'sessions.open-beside': customChord,
      'sessions.close-beside': null,
    };
    expect(
      await loadLegacyOverrides({
        'sessions.open-in-split': customChord,
        'sessions.close-split': null,
      }),
    ).toEqual(expected);
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({
      version: 1,
      state: { overrides: expected },
    });
    useKeybindingsStore.getState().reset('sessions.open-beside');
    await useKeybindingsStore.persist.rehydrate();
    expect(useKeybindingsStore.getState().overrides).toEqual({ 'sessions.close-beside': null });
  });

  it('keeps a newer override even when it is unassigned', async () => {
    expect(
      await loadLegacyOverrides({
        'sessions.open-in-split': customChord,
        'sessions.open-beside': null,
      }),
    ).toEqual({ 'sessions.open-beside': null });
  });

  it('keeps a pair of overrides that swapped the old defaults', async () => {
    const openDefault = { code: 'Backslash', mod: true, shift: true };
    const closeDefault = { code: 'Backslash', mod: true };
    expect(
      await loadLegacyOverrides({
        'sessions.open-in-split': closeDefault,
        'sessions.close-split': openDefault,
      }),
    ).toEqual({
      'sessions.open-beside': closeDefault,
      'sessions.close-beside': openDefault,
    });
  });

  it('preserves the holders of both a custom chord and a registry default', async () => {
    expect(
      await loadLegacyOverrides({
        'sessions.open-in-split': customChord,
        'sessions.close-split': { code: 'KeyK', mod: true },
        'chat.find': customChord,
      }),
    ).toEqual({ 'chat.find': customChord });
  });
});
