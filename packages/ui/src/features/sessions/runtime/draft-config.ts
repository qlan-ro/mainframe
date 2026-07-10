/**
 * Draft-config side-channel for the native New-thread flow.
 *
 * A `__LOCALID_*` thread has no daemon chat yet; the project/adapter/model/tuning
 * the user picks (in the new-session picker / welcome flow, or live in the
 * composer toolbar before the first send) is stashed here keyed by the local
 * threadId, then read by the new-thread coordinator on first send to POST
 * createChat (+ apply tuning).
 *
 * Reactive (zustand) so the composer toolbar re-renders when the user edits a
 * draft before sending. The imperative wrappers keep the synchronous get/set the
 * non-React coordinator relies on; `useDraftConfig` is the reactive read.
 */
import { create } from 'zustand';
import type { EffortLevel, PermissionMode } from '@qlan-ro/mainframe-types';

export interface DraftCfg {
  projectId: string;
  adapterId: string;
  model?: string;
  /**
   * Optional. When unset, chat creation omits it so the daemon applies the
   * user's provider `defaultMode` (e.g. yolo) — matching desktop. Only a
   * deliberate per-chat pick sets it.
   */
  permissionMode?: PermissionMode;
  planMode?: boolean;
  effort?: EffortLevel | null;
  fast?: boolean | null;
  ultracode?: boolean | null;
  adaptiveThinking?: boolean | null;
  worktreePath?: string;
  branchName?: string;
  /**
   * A "New" worktree chosen pre-send. It cannot be created yet (enable-worktree
   * is chat-scoped and no daemon chat exists), so the coordinator runs
   * enable-worktree right after createChat on first send.
   */
  pendingWorktree?: { baseBranch: string; branchName: string };
}

interface DraftConfigState {
  readonly drafts: ReadonlyMap<string, DraftCfg>;
  setDraft: (localId: string, cfg: DraftCfg) => void;
  patchDraft: (localId: string, partial: Partial<DraftCfg>) => void;
  clearDraft: (localId: string) => void;
}

export const useDraftConfigStore = create<DraftConfigState>((set) => ({
  drafts: new Map<string, DraftCfg>(),
  setDraft: (localId, cfg) =>
    set((s) => {
      const next = new Map(s.drafts);
      next.set(localId, cfg);
      return { drafts: next };
    }),
  patchDraft: (localId, partial) =>
    set((s) => {
      const existing = s.drafts.get(localId);
      if (!existing) return s; // only patch a draft that already exists
      const next = new Map(s.drafts);
      next.set(localId, { ...existing, ...partial });
      return { drafts: next };
    }),
  clearDraft: (localId) =>
    set((s) => {
      if (!s.drafts.has(localId)) return s; // stable ref — no churn
      const next = new Map(s.drafts);
      next.delete(localId);
      return { drafts: next };
    }),
}));

// Imperative wrappers — the coordinator + picker call these synchronously.
export const setDraftConfig = (localId: string, cfg: DraftCfg): void =>
  useDraftConfigStore.getState().setDraft(localId, cfg);
export const getDraftConfig = (localId: string): DraftCfg | undefined =>
  useDraftConfigStore.getState().drafts.get(localId);
export const patchDraftConfig = (localId: string, partial: Partial<DraftCfg>): void =>
  useDraftConfigStore.getState().patchDraft(localId, partial);
export const clearDraftConfig = (localId: string): void => useDraftConfigStore.getState().clearDraft(localId);

/** Reactive read for the composer toolbar. Null id → undefined (no subscription churn). */
export function useDraftConfig(localId: string | null): DraftCfg | undefined {
  return useDraftConfigStore((s) => (localId ? s.drafts.get(localId) : undefined));
}
