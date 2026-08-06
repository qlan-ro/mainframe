/**
 * The v2 binding of the new-thread draft sequence.
 *
 * The sequence itself is order-sensitive and already dependency-injected, so
 * this only supplies the runtime, the stores and a toast. The shipped binding
 * would drag the v1 toast card across the boundary; everything else is shared.
 */
import { useAssistantRuntime, useAui } from '@assistant-ui/react';
import { toast } from 'sonner';
import { openNewThreadDraft, type OpenNewThreadDraftArgs } from '@/features/sessions/new-thread/open-new-thread-draft';
import { resetNewThreadDraft } from '@/features/sessions/new-thread/reset-new-thread-draft';
import { initializeDraft } from '@/features/sessions/new-thread/initialize-draft';
import { useDraftReturnTarget } from '@/features/sessions/new-thread/use-draft-return-target';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useSessionFilters } from '@/store/session-filters';
import { useSettingsStore } from '@/store/settings';
import { useAdapters } from '@/store/adapters';

export function useOpenDraft(): (args: OpenNewThreadDraftArgs) => Promise<void> {
  const runtime = useAssistantRuntime();
  const aui = useAui();
  const filterProjectId = useSessionFilters((s) => s.filterProjectId);
  const setFilterProjectId = useSessionFilters((s) => s.setFilterProjectId);
  const defaultAdapterId = useSettingsStore((s) => s.general.defaultAdapterId);
  const adapters = useAdapters();
  const port = useDaemonPort();

  return (args: OpenNewThreadDraftArgs) =>
    openNewThreadDraft(args, {
      filterProjectId,
      setFilterProjectId,
      runtimeThreads: runtime.threads,
      setReturnTarget: (id) => useDraftReturnTarget.getState().setReturnTarget(id),
      resetNewThreadDraft,
      initializeDraft: ({ localId, projectId }) =>
        initializeDraft({ localId, projectId, port, defaultAdapterId, adapters }),
      setText: (text) => aui.composer().setText(text),
      mfToastError: (title, options) => toast.error(title, options),
    });
}
