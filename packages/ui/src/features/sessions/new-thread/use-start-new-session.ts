/**
 * useStartNewSession — the one action every "+" entry point calls (sidebar
 * button, sidebar New Thread row, tab-strip "+", ⌘N).
 *
 * Resolves the target via resolveNewSessionProject (pill → active session's
 * project → none). With a target, stashes it in pendingDraftProject BEFORE
 * running the existing openNewThreadDraft sequence (reset slot → return
 * target → switch → initializeDraft) so ChatSurface's initializing gate never
 * flashes the choose-a-project welcome; the pending value is cleared once the
 * sequence settles, success or failure. Without a target, resets the slot,
 * records the return target and switches — exactly the projectless path every
 * entry point already ran — leaving the welcome screen's own picker in charge.
 */
import { useAui } from '@assistant-ui/react';
import { soleProjectId, useSessionFilters } from '@/store/session-filters';
import { useActiveIdentity } from '../use-active-identity';
import { resetNewThreadDraft } from './reset-new-thread-draft';
import { useDraftReturnTarget } from './use-draft-return-target';
import { useOpenNewThreadDraft } from './use-open-new-thread-draft';
import { usePendingDraftProject } from './pending-draft-project';
import { resolveNewSessionProject } from './resolve-new-session-project';

export function useStartNewSession(): () => void {
  const aui = useAui();
  const filterProjectIds = useSessionFilters((s) => s.filterProjectIds);
  const activeProjectId = useActiveIdentity().projectId;
  const openNewThreadDraft = useOpenNewThreadDraft();

  return () => {
    const target = resolveNewSessionProject(soleProjectId(filterProjectIds), activeProjectId);
    const { mainThreadId, newThreadId } = aui.threads.getState();

    if (target == null) {
      useDraftReturnTarget.getState().setReturnTarget(mainThreadId ?? null);
      resetNewThreadDraft(newThreadId);
      void aui.threads.switchToNewThread();
      return;
    }

    const pendingToken = usePendingDraftProject.getState().setPendingProject(target);
    void openNewThreadDraft({ projectId: target })
      .catch(() => undefined)
      .finally(() => usePendingDraftProject.getState().clearPendingProject(pendingToken));
  };
}
