/**
 * useSelectDraftProject — (re)scope the CURRENT draft to a project, from the
 * welcome screen's picker.
 *
 * Deliberately NOT the full openNewThreadDraft sequence: the draft is already
 * the active thread, so there is no switch and — crucially — no return-target
 * write (the full sequence would point "cancel" back at the draft itself,
 * losing the route to the previous session). Just the seeding half: reset the
 * slot's stale config/segments, initialize for the picked project, and clear a
 * mismatching project filter the way the full sequence does.
 */
import { useAui } from '@assistant-ui/react';
import { mfToast } from '@/lib/toast';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useSessionFilters } from '@/store/session-filters';
import { useSettingsStore } from '@/store/settings';
import { useAdapters } from '@/store/adapters';
import { initializeDraft } from './initialize-draft';
import { resetNewThreadDraft } from './reset-new-thread-draft';

export function useSelectDraftProject(): (projectId: string) => Promise<void> {
  const aui = useAui();
  const port = useDaemonPort();
  const filterProjectId = useSessionFilters((s) => s.filterProjectId);
  const setFilterProjectId = useSessionFilters((s) => s.setFilterProjectId);
  const defaultAdapterId = useSettingsStore((s) => s.general.defaultAdapterId);
  const adapters = useAdapters();

  return async (projectId: string) => {
    const threads = aui.threads.getState();
    const localId = threads.newThreadId ?? threads.mainThreadId;
    if (localId == null) return;
    if (filterProjectId != null && filterProjectId !== projectId) setFilterProjectId(null);
    resetNewThreadDraft(threads.newThreadId);
    try {
      await initializeDraft({ localId, projectId, port, defaultAdapterId, adapters });
    } catch (error) {
      mfToast.error('Couldn’t initialize session', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };
}
