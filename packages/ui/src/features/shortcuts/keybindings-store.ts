/**
 * User overrides for the shortcut registry — the one mutable layer over
 * `registry.ts`, which stays pure declarative defaults.
 *
 * Per machine, not per account: a keymap belongs to the keyboard in front of
 * you, and syncing it would need a daemon contract change co-owned with a
 * mobile client that has no hardware keyboard to bind.
 *
 * An id absent from `overrides` uses its registry default. An id mapped to
 * `null` is one the user left UNASSIGNED — distinct from "default", and the
 * state a chord lands in after another action steals it.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Chord } from './shortcut-types';

/** A rebound chord, or `null` for an intentionally unassigned shortcut. */
export type Binding = Chord | null;

export type Overrides = Record<string, Binding>;

interface KeybindingsStore {
  overrides: Overrides;
  setOverrides: (next: Overrides) => void;
  /** Drop one id's override, returning it to the registry default. */
  reset: (id: string) => void;
  resetAll: () => void;
}

export const useKeybindingsStore = create<KeybindingsStore>()(
  persist(
    (set) => ({
      overrides: {},
      setOverrides: (next) => set({ overrides: next }),
      reset: (id) =>
        set((s) => {
          const next = { ...s.overrides };
          delete next[id];
          return { overrides: next };
        }),
      resetAll: () => set({ overrides: {} }),
    }),
    { name: 'mf:keybindings' },
  ),
);
