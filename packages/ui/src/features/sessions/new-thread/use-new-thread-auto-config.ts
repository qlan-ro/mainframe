/**
 * useNewThreadAutoConfig — skip the project picker when a project pill is active.
 *
 * When a new (`__LOCALID_*`) thread becomes active AND a specific project is
 * selected in the sidebar, seed its draft (that project + claude + default model
 * & permission, matching desktop's startChat) and mark it ready — so ChatSurface
 * drops straight into the composer instead of the picker. In the "All" view (no
 * project filter) it does nothing, so the picker shows for the user to choose a
 * project. The daemon chat is still created only on first send (D3).
 */
import { useEffect } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { useSessionFilters } from '@/store/session-filters';
import { useSettingsStore } from '@/store/settings';
import { useAdapters } from '@/store/adapters';
import { getDraftConfig, setDraftConfig } from '../runtime/draft-config';
import { useNewThreadReady } from '../runtime/new-thread-ready-store';
import { isDraftDiscarded } from './discarded-drafts';
import { resolveDefaultAdapterId } from './default-adapter';

export function useNewThreadAutoConfig(): void {
  const localId = useAuiState((s) => s.threadListItem?.id ?? null);
  const itemStatus = useAuiState((s) => s.threadListItem?.status);
  const messageCount = useAuiState((s) => s.thread.messages.length);
  const filterProjectId = useSessionFilters((s) => s.filterProjectId);
  const isReady = useNewThreadReady((s) => (localId ? s.readyIds.has(localId) : false));
  const defaultAdapterId = useSettingsStore((s) => s.general.defaultAdapterId);
  const adapters = useAdapters();

  useEffect(() => {
    if (localId == null || filterProjectId == null) return;
    const isNewLocal = localId.startsWith('__LOCALID_') && itemStatus === 'new' && messageCount === 0;
    // A just-discarded draft (✕) still looks fresh here — its draft-config and
    // ready flag were just cleared, and switchToThread(target) away from it
    // hasn't landed yet. Without this guard we'd instantly re-seed the exact
    // draft the user just closed (see discarded-drafts.ts).
    if (!isNewLocal || isReady || getDraftConfig(localId) || isDraftDiscarded(localId)) return;
    const adapterId = resolveDefaultAdapterId(defaultAdapterId, adapters);
    // No permissionMode: chat creation omits it so the daemon applies the user's
    // provider defaultMode (matching desktop). A deliberate pick sets it later.
    setDraftConfig(localId, { projectId: filterProjectId, adapterId });
    useNewThreadReady.getState().markReady(localId);
  }, [localId, itemStatus, messageCount, filterProjectId, isReady, defaultAdapterId, adapters]);
}
