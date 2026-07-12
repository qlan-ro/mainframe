/**
 * useActiveIdentity — the active session's project name + worktree branch for the
 * shell MainToolbar. Reads the active thread-list item's freshest `custom`
 * (via activeSessionCustom) for projectId + branchName, and resolves the project
 * name from the loaded project list. Runs inside the assistant-ui runtime provider.
 *
 * Draft-aware (todo #223): a `__LOCALID_*` thread has no custom until the first
 * send creates the daemon chat, so the scope falls back to the seeded draft
 * config — project-scoped surfaces (file tree, branch chip, skills, launch
 * scope) resolve while composing. The first-send gap (draft consumed, reload
 * pending) is bridged so those surfaces don't flicker dark mid-handoff.
 *
 * Also exposes `worktreePath` and `projectPath` so callers (AppShell) can push
 * the canonical bases into `useActiveBasesStore` for the intent subscriber (F1 fix).
 */
import { useEffect, useRef } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useProjects } from './use-projects';
import { activeSessionCustom } from './view-model/chat-to-thread-custom';
import { useActiveDraftConfig } from './use-active-draft-config';
import { useDiscardedDraftStore } from './new-thread/discarded-drafts';
import { resolveActiveScope, bridgeScopeGap, type ScopeCache } from './view-model/draft-identity';

export interface ActiveIdentity {
  projectName: string;
  branchName?: string;
  /** Active session's project id (for file-tree / git scoping). */
  projectId?: string;
  /** Active session's adapter id (e.g. 'claude' / 'codex') — for skills/agents scoping. */
  adapterId?: string;
  /** Active session's remote chat id (worktree-correct path resolution). */
  chatId?: string;
  /** Absolute path to the active chat's worktree (for path normalization). */
  worktreePath?: string;
  /** Absolute path to the active project root (for path normalization). */
  projectPath?: string;
  /** Worktree isolation for the branch chip — true for a pending pre-send choice too. */
  isWorktree: boolean;
}

export function useActiveIdentity(): ActiveIdentity {
  // activeSessionCustom prefers the remoteId-keyed list entry (refreshed by every
  // threads.reload()) over the active item's own custom, which goes permanently
  // stale on __LOCALID_* threads (returned refs are store-stable, Object.is-safe).
  const custom = useAuiState((s) => activeSessionCustom(s.threadListItem, s.threads.threadItems));
  const chatId = useAuiState((s) => s.threadListItem?.remoteId ?? undefined);
  const localId = useAuiState((s) => s.threadListItem?.id ?? null);
  const draft = useActiveDraftConfig();

  // An explicitly discarded (✕) slot must not be bridged — the user may stay
  // parked on it, and the gap-bridge alone can't tell that from a first send.
  const discarded = useDiscardedDraftStore((s) => localId != null && s.ids.has(localId));

  const cacheRef = useRef<ScopeCache | null>(null);
  const bridged = bridgeScopeGap(cacheRef.current, localId, resolveActiveScope(custom, draft), discarded);
  useEffect(() => {
    cacheRef.current = bridged.cache;
  });
  const scope = bridged.scope;

  const { projects } = useProjects();
  const project = scope.projectId ? projects.find((p) => p.id === scope.projectId) : undefined;
  return {
    projectName: project?.name ?? 'Mainframe',
    branchName: scope.branchName,
    projectId: scope.projectId,
    adapterId: scope.adapterId,
    chatId,
    worktreePath: scope.worktreePath,
    projectPath: project?.path,
    isWorktree: scope.isWorktree ?? false,
  };
}
