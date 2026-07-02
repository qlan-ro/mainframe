/**
 * useDraftRow — reactive draft-row model + select/discard handlers for the
 * sidebar's synthetic "New Session" row. Extracted out of SessionSidebar so the
 * wiring stays a few lines there (see the file's own size-budget note).
 *
 * Reactive: subscribes to the store-scope newThreadId/mainThreadId and the
 * draft-config for that id, so the row appears the instant a project resolves
 * the draft (picker pick, pill-active "+", or auto-config) and disappears the
 * instant it's discarded or committed — no imperative getState() polling.
 */
import { useCallback, useEffect } from 'react';
import { useAssistantRuntime, useAuiState } from '@assistant-ui/react';
import type { SessionItem } from '../view-model/chat-to-thread-custom';
import { draftRowVisible, type DraftRowModel } from '../new-thread/draft-row';
import { useDraftReturnTarget } from '../new-thread/use-draft-return-target';
import { useDraftConfigStore } from '../runtime/draft-config';
import { resetNewThreadDraft } from '../new-thread/reset-new-thread-draft';

export interface DraftRowState {
  model: DraftRowModel | null;
  visible: boolean;
  selected: boolean;
  onSelect: () => void;
  onDiscard: () => void;
}

export function useDraftRow(allItems: SessionItem[], filterProjectId: string | null): DraftRowState {
  const runtime = useAssistantRuntime();
  const newThreadId = useAuiState((s) => s.threads.newThreadId);
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const draftCfg = useDraftConfigStore((s) => (newThreadId ? s.drafts.get(newThreadId) : undefined));

  const model: DraftRowModel | null =
    draftCfg != null && newThreadId != null ? { newThreadId, projectId: draftCfg.projectId } : null;
  const visible = draftRowVisible(model, filterProjectId);
  const selected = model != null && mainThreadId === model.newThreadId;

  // Discard-on-navigate-away: the draft is unsent (draftCfg still exists) and the
  // user has switched the active thread to something else — treat that exactly
  // like the explicit ✕ discard. Guard against the first-send commit path (the
  // coordinator clears draftCfg but keeps the SAME local id — no id-flip, see
  // new-thread-coordinator.ts) by requiring a draft to still exist; a commit
  // clears it in the same tick, so `hasDraft` is already false by the time this
  // effect would otherwise fire. `mainThreadId` is falsy at boot (before any
  // thread is selected) — treat that as "not navigated" rather than "other".
  const hasDraft = draftCfg != null;
  useEffect(() => {
    if (!hasDraft) return;
    if (newThreadId == null) return;
    if (!mainThreadId) return;
    if (mainThreadId === newThreadId) return;
    resetNewThreadDraft(newThreadId);
    useDraftReturnTarget.getState().clear();
  }, [mainThreadId, newThreadId, hasDraft]);

  const onSelect = useCallback(() => {
    if (model != null) runtime.threads.switchToThread(model.newThreadId);
  }, [model, runtime]);

  const onDiscard = useCallback(() => {
    if (newThreadId == null) return;
    resetNewThreadDraft(newThreadId);
    const { returnThreadId, clear } = useDraftReturnTarget.getState();
    const target = returnThreadId ?? allItems[0]?.id ?? null;
    if (target != null) runtime.threads.switchToThread(target);
    clear();
  }, [newThreadId, allItems, runtime]);

  return { model, visible, selected, onSelect, onDiscard };
}
