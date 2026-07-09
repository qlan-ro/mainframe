/**
 * useActiveIdentity — the active session's project name + worktree branch for the
 * shell MainToolbar. Reads the active thread-list item's freshest `custom`
 * (via activeSessionCustom) for projectId + branchName, and resolves the project
 * name from the loaded project list. Runs inside the assistant-ui runtime provider.
 *
 * Also exposes `worktreePath` and `projectPath` so callers (AppShell) can push
 * the canonical bases into `useActiveBasesStore` for the intent subscriber (F1 fix).
 */
import { useAuiState } from '@assistant-ui/react';
import { useProjects } from './use-projects';
import { activeSessionCustom } from './view-model/chat-to-thread-custom';

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
}

export function useActiveIdentity(): ActiveIdentity {
  // activeSessionCustom prefers the remoteId-keyed list entry (refreshed by every
  // threads.reload()) over the active item's own custom, which goes permanently
  // stale on __LOCALID_* threads (returned refs are store-stable, Object.is-safe).
  const custom = useAuiState((s) => activeSessionCustom(s.threadListItem, s.threads.threadItems));
  const chatId = useAuiState((s) => s.threadListItem?.remoteId ?? undefined);
  const { projects } = useProjects();
  const project = custom?.projectId ? projects.find((p) => p.id === custom.projectId) : undefined;
  return {
    projectName: project?.name ?? 'Mainframe',
    branchName: custom?.branchName,
    projectId: custom?.projectId,
    adapterId: custom?.adapterId,
    chatId,
    worktreePath: custom?.worktreePath,
    projectPath: project?.path,
  };
}
