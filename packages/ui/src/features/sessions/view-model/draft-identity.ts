/**
 * Draft-aware active-scope derivation (todo #223).
 *
 * A new (`__LOCALID_*`) thread has no aui `custom` until the first send creates
 * the daemon chat, so every custom-derived surface (file tree, branch chip,
 * skills, launch scope) went dark while composing — even though the new-session
 * entry points had already seeded the draft config with the project. These pure
 * helpers resolve the active scope from the freshest custom OR that draft, and
 * bridge the first-send gap (draft consumed by the coordinator, threads.reload
 * not yet landed) so surfaces don't flicker dark mid-handoff.
 *
 * Pure and aui-free (type-only imports), matching the rest of the view-model.
 */
import type { SessionCustom } from './chat-to-thread-custom';
import type { DraftCfg } from '../runtime/draft-config';

/** The custom-derived fields project-scoped surfaces key off. */
export interface ActiveScope {
  projectId?: string;
  adapterId?: string;
  branchName?: string;
  worktreePath?: string;
  /** Worktree isolation for the branch chip — includes a pending pre-send choice. */
  isWorktree?: boolean;
}

/**
 * Resolve the active scope: a live session's custom wins wholesale (never mix a
 * draft into it — the draft belongs to a different, not-yet-created thread
 * state); the draft fills in only when no custom exists.
 *
 * A draft's pending NEW worktree resolves its branch + isWorktree (the chip
 * shows the chosen isolation, matching the attach case) but never a
 * worktreePath — the directory doesn't exist until first send, so path-scoped
 * surfaces (file tree, launch scope) must keep reading the project root.
 */
export function resolveActiveScope(custom: SessionCustom | undefined, draft: DraftCfg | undefined): ActiveScope {
  if (custom) {
    return {
      projectId: custom.projectId,
      adapterId: custom.adapterId,
      branchName: custom.branchName,
      worktreePath: custom.worktreePath,
      isWorktree: custom.worktreePath != null,
    };
  }
  if (draft) {
    return {
      projectId: draft.projectId,
      adapterId: draft.adapterId,
      branchName: draft.branchName ?? draft.pendingWorktree?.branchName,
      worktreePath: draft.worktreePath,
      isWorktree: draft.worktreePath != null || draft.pendingWorktree != null,
    };
  }
  return { isWorktree: false };
}

/** Last resolved scope, keyed by the thread item it was resolved for. */
export interface ScopeCache {
  itemId: string;
  scope: ActiveScope;
}

/**
 * First-send gap continuity: on send, the coordinator clears the draft config
 * BEFORE the `chat.created` reload lands the remoteId-keyed custom, so the same
 * `__LOCALID_*` item briefly resolves an empty scope. Returning the cached scope
 * for the SAME item keeps the file tree / chip / run scope lit through the
 * handoff. A different item never inherits the cache (a fresh draft slot or a
 * real thread must resolve on its own).
 */
export function bridgeScopeGap(
  cache: ScopeCache | null,
  itemId: string | null,
  raw: ActiveScope,
): { scope: ActiveScope; cache: ScopeCache | null } {
  if (itemId != null && raw.projectId != null) {
    return { scope: raw, cache: { itemId, scope: raw } };
  }
  if (itemId != null && cache != null && cache.itemId === itemId) {
    return { scope: cache.scope, cache };
  }
  return { scope: raw, cache: null };
}
