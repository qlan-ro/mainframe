/**
 * useStartNewSession — the one action every "+" entry point calls (sidebar
 * button, sidebar New Thread row, tab-strip "+", ⌘N).
 *
 * Resolves the target via resolveNewSessionProject (pill → active session's
 * project → in-flight target on the draft being initialized → none — todo
 * #365's fallback covers the window where the draft has no config yet, so
 * `useActiveIdentity` alone would report no project). With a target, stashes
 * it in pendingDraftProject BEFORE running the existing openNewThreadDraft
 * sequence (reset slot → return target → switch → initializeDraft) so
 * ChatSurface's initializing gate never flashes the choose-a-project welcome;
 * the pending value is cleared once the sequence settles, success or failure.
 * Without a target, resets the slot, records the return target (unless the
 * active thread is already the slot — its own return target stays) and
 * switches — exactly the projectless path every entry point already ran —
 * leaving the welcome screen's own picker in charge.
 *
 * A second trigger for the SAME target while the active thread's draft is
 * still resolving that target (the pending stash, or an `'initializing'`
 * initialization record — see `readInFlightNewSessionTarget`) is a no-op: it
 * neither resets the reused slot (which would drop the first attempt's
 * in-flight record) nor re-records the return target. A DIFFERENT target
 * (e.g. the filter pill changed between clicks) runs the full sequence again,
 * so the latest trigger wins.
 */
import { useAui } from '@assistant-ui/react';
import { soleProjectId, useSessionFilters } from '@/store/session-filters';
import { useActiveIdentity } from '../use-active-identity';
import { resetNewThreadDraft } from './reset-new-thread-draft';
import { useDraftReturnTarget } from './use-draft-return-target';
import { useOpenNewThreadDraft } from './use-open-new-thread-draft';
import { usePendingDraftProject } from './pending-draft-project';
import { resolveNewSessionProject } from './resolve-new-session-project';
import { readInFlightNewSessionTarget } from './in-flight-new-session-target';

export function useStartNewSession(): () => void {
  const aui = useAui();
  const filterProjectIds = useSessionFilters((s) => s.filterProjectIds);
  const activeProjectId = useActiveIdentity().projectId;
  const openNewThreadDraft = useOpenNewThreadDraft();

  return () => {
    const { mainThreadId, newThreadId } = aui.threads.getState();
    const isActiveSlot = mainThreadId != null && newThreadId != null && mainThreadId === newThreadId;
    const inFlight = readInFlightNewSessionTarget(newThreadId ?? null, isActiveSlot);

    const target = resolveNewSessionProject(
      soleProjectId(filterProjectIds),
      activeProjectId ?? inFlight.target ?? undefined,
    );

    if (inFlight.blocking && target != null && target === inFlight.target) {
      // Same target already resolving for this draft — a repeat trigger (or a
      // held ⌘N without the repeat guard) is a no-op.
      return;
    }

    if (target == null) {
      if (!isActiveSlot) useDraftReturnTarget.getState().setReturnTarget(mainThreadId ?? null);
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
