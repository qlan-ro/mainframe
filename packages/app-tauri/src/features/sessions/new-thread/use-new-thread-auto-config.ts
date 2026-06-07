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
import { getDraftConfig, setDraftConfig } from '../runtime/draft-config';
import { useNewThreadReady } from '../runtime/new-thread-ready-store';

/** Default adapter for a project-scoped new thread (matches desktop startChat). */
const DEFAULT_ADAPTER_ID = 'claude';

export function useNewThreadAutoConfig(): void {
  const localId = useAuiState((s) => s.threadListItem?.id ?? null);
  const itemStatus = useAuiState((s) => s.threadListItem?.status);
  const messageCount = useAuiState((s) => s.thread.messages.length);
  const filterProjectId = useSessionFilters((s) => s.filterProjectId);
  const isReady = useNewThreadReady((s) => (localId ? s.readyIds.has(localId) : false));

  useEffect(() => {
    if (localId == null || filterProjectId == null) return;
    const isNewLocal = localId.startsWith('__LOCALID_') && itemStatus === 'new' && messageCount === 0;
    if (!isNewLocal || isReady || getDraftConfig(localId)) return;
    setDraftConfig(localId, { projectId: filterProjectId, adapterId: DEFAULT_ADAPTER_ID, permissionMode: 'default' });
    useNewThreadReady.getState().markReady(localId);
  }, [localId, itemStatus, messageCount, filterProjectId, isReady]);
}
