import { useEffect, useState, useSyncExternalStore } from 'react';
import { getDraftConfig, useDraftConfigStore } from '../runtime/draft-config';
import { isCreatePending, subscribeCreateLifecycle } from '../runtime/new-thread-coordinator';
import { resetNewThreadDraft } from '../new-thread/reset-new-thread-draft';
import { useDraftReturnTarget } from '../new-thread/use-draft-return-target';

export function useDraftNavigationCleanup(newThreadId: string | null, mainThreadId: string): void {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedCfg = useDraftConfigStore((s) => (selectedId ? s.drafts.get(selectedId) : undefined));
  const currentCfg = useDraftConfigStore((s) => (newThreadId ? s.drafts.get(newThreadId) : undefined));
  const pending = useSyncExternalStore(subscribeCreateLifecycle, () =>
    selectedId ? isCreatePending(selectedId) : false,
  );

  useEffect(
    () =>
      useDraftConfigStore.subscribe((state) => {
        // A reset and rearm can be batched into one render for a recycled local id.
        if (selectedId && !state.drafts.has(selectedId)) setSelectedId(null);
      }),
    [selectedId],
  );

  useEffect(() => {
    if (selectedId) {
      if (!selectedCfg) {
        setSelectedId(null);
        return;
      }
      if (!mainThreadId || mainThreadId === selectedId || pending) return;
      // Configuration and native thread identity publish independently.
      if (getDraftConfig(selectedId) === selectedCfg && !isCreatePending(selectedId)) {
        resetNewThreadDraft(selectedId);
        useDraftReturnTarget.getState().clear();
      }
      setSelectedId(null);
      return;
    }
    if (newThreadId && mainThreadId === newThreadId && currentCfg && getDraftConfig(newThreadId) === currentCfg) {
      setSelectedId(newThreadId);
    }
  }, [selectedId, selectedCfg, newThreadId, mainThreadId, currentCfg, pending]);
}
