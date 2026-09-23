/**
 * useOpenNewThreadDraft — binds openNewThreadDraft's dependencies to the real
 * aui client and stores. Both the sidebar "New" button and the selection
 * toolbar's "New session" action call the returned function.
 */
import { useAui } from '@assistant-ui/react';
import { openNewThreadDraft, type OpenNewThreadDraftArgs } from './open-new-thread-draft';
import { resetNewThreadDraft } from './reset-new-thread-draft';
import { initializeDraft } from './initialize-draft';
import { useDraftReturnTarget } from './use-draft-return-target';
import { useSessionFilters } from '@/store/session-filters';
import { useSettingsStore } from '@/store/settings';
import { useAdapters } from '@/store/adapters';
import { useDaemonPort } from '../runtime/daemon-port-context';
import { mfToast } from '@/lib/toast';

export function useOpenNewThreadDraft(): (args: OpenNewThreadDraftArgs) => Promise<void> {
  const aui = useAui();
  const filterProjectIds = useSessionFilters((s) => s.filterProjectIds);
  const clearProjectFilter = useSessionFilters((s) => s.clearProjectFilter);
  const defaultAdapterId = useSettingsStore((s) => s.general.defaultAdapterId);
  const adapters = useAdapters();
  const port = useDaemonPort();

  return (args: OpenNewThreadDraftArgs) =>
    openNewThreadDraft(args, {
      filterProjectIds,
      clearProjectFilter,
      runtimeThreads: aui.threads,
      setReturnTarget: (id) => useDraftReturnTarget.getState().setReturnTarget(id),
      resetNewThreadDraft,
      initializeDraft: ({ localId, projectId, adapterId }) =>
        initializeDraft({ localId, projectId, port, defaultAdapterId, adapters, adapterId }),
      // The live main-thread composer, not `aui.composer` — that's rebound to a
      // message's edit composer inside a message (e.g. the instruction chip) and
      // is a scoped stand-in elsewhere. `threads.thread('main')` is a root scope
      // no provider shadows.
      setText: (text) => aui.threads.thread('main').composer().setText(text),
      mfToastError: (title, options) => mfToast.error(title, options),
    });
}
