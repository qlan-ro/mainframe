/**
 * useSkillsRevalidation — the one signal that re-runs every skills fetch.
 *
 * Three independent consumers mount-fetch skills — the composer `/`-trigger
 * provider, the sidebar bottom-panel hook, and the setup-advisor Skills section
 * — with no shared store and no daemon broadcast when a skill changes on disk.
 * Without this nonce, deleting a skill in the dialog leaves the other two
 * surfaces showing it until an app reload.
 *
 * Consumers append `useSkillsNonce()` to their fetch effect's dep array;
 * writers call `bumpSkillsRevalidation()`, which works outside React so a
 * delete handler or a store reset can fire it.
 */
import { create } from 'zustand';

interface SkillsRevalidationState {
  nonce: number;
}

export const useSkillsRevalidation = create<SkillsRevalidationState>(() => ({ nonce: 0 }));

/** Invalidate every skills read surface. Callable outside a React tree. */
export function bumpSkillsRevalidation(): void {
  useSkillsRevalidation.setState((s) => ({ nonce: s.nonce + 1 }));
}

/** Subscribe a fetch effect to the shared signal. */
export function useSkillsNonce(): number {
  return useSkillsRevalidation((s) => s.nonce);
}
