// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useKeybindingsStore, type Overrides } from '../keybindings-store';

const storageKey = 'mf:keybindings';
const customChord = { code: 'KeyY', mod: true, shift: true };

async function loadLegacyOverrides(overrides: Record<string, unknown>) {
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
    useKeybindingsStore.getState().setOverrides((current) => current);
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({
      version: 0,
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
    ).toEqual({ 'chat.find': customChord, 'sessions.open-beside': null, 'sessions.close-beside': null });
  });

  it('does not restore a default owned by Find after Stop blocks the carried chord', async () => {
    const findChord = { code: 'Backslash', mod: true, shift: true };
    expect(
      await loadLegacyOverrides({
        'chat.find': findChord,
        'sessions.open-in-split': { code: 'Period', mod: true },
      }),
    ).toEqual({ 'chat.find': findChord, 'sessions.open-beside': null });
  });

  it('discards malformed chords before checking conflicts', async () => {
    expect(
      await loadLegacyOverrides({
        'sessions.open-in-split': { code: 'Period', mod: 'false' },
        'sessions.close-split': { mac: null, other: null },
        'chat.find': { code: 42 },
        'chat.stop': customChord,
      }),
    ).toEqual({ 'chat.stop': customChord });
  });

  it('clears a legacy override on reset before any upgraded write', async () => {
    await loadLegacyOverrides({ 'sessions.open-in-split': customChord });
    useKeybindingsStore.getState().reset('sessions.open-beside');
    await useKeybindingsStore.persist.rehydrate();
    expect(useKeybindingsStore.getState().overrides).toEqual({});
  });

  it('preserves preferences across a version-0 app write and re-upgrade', async () => {
    await loadLegacyOverrides({ 'sessions.open-in-split': customChord });
    useKeybindingsStore.getState().setOverrides((current) => ({ ...current, 'chat.find': null }));
    const olderStore = create(persist(() => ({ overrides: {} as Overrides }), { name: storageKey }));
    const saved = { 'sessions.open-beside': customChord, 'chat.find': null };
    expect(olderStore.getState().overrides).toEqual(saved);
    olderStore.setState({ overrides: { ...saved, 'sessions.close-split': null } });
    await useKeybindingsStore.persist.rehydrate();
    expect(useKeybindingsStore.getState().overrides).toEqual({ ...saved, 'sessions.close-beside': null });
  });

  it('merges a second window write even before the storage event arrives', async () => {
    await loadLegacyOverrides({});
    const remote = { 'sessions.open-in-split': customChord, 'chat.stop': null };
    localStorage.setItem(storageKey, JSON.stringify({ version: 0, state: { overrides: remote } }));
    useKeybindingsStore.getState().setOverrides((current) => ({ ...current, 'chat.find': null }));
    expect(useKeybindingsStore.getState().overrides).toEqual({
      'sessions.open-beside': customChord,
      'chat.stop': null,
      'chat.find': null,
    });

    localStorage.removeItem(storageKey);
    window.dispatchEvent(new StorageEvent('storage', { key: storageKey }));
    expect(useKeybindingsStore.getState().overrides).toEqual({});
  });
});
