/**
 * useActiveDraftConfig — the active thread's draft config, but ONLY while it is
 * a `__LOCALID_*` draft with no session custom yet (pre-first-send).
 *
 * The single gate for "should this surface read the draft instead of aui
 * custom" — shared by useActiveIdentity and the toolbar BranchPopover so the
 * draft/live decision can't drift between consumers. Once any custom resolves
 * (the thread is a real session), the draft is never consulted.
 */
import { useAuiState } from '@assistant-ui/react';
import { activeSessionCustom } from './view-model/chat-to-thread-custom';
import { useDraftConfig, type DraftCfg } from './runtime/draft-config';

export function useActiveDraftConfig(): DraftCfg | undefined {
  const localId = useAuiState((s) => s.threadListItem?.id ?? null);
  const hasCustom = useAuiState((s) => activeSessionCustom(s.threadListItem, s.threads.threadItems) != null);
  const isDraft = !hasCustom && localId != null && localId.startsWith('__LOCALID_');
  return useDraftConfig(isDraft ? localId : null);
}
