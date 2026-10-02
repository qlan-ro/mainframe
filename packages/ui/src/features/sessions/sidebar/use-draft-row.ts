import { useCallback } from 'react';
import { useAui, useAuiState } from '@assistant-ui/react';
import type { SessionItem } from '../view-model/chat-to-thread-custom';
import { draftRowVisible, type DraftRowModel } from '../new-thread/draft-row';
import { useDraftReturnTarget } from '../new-thread/use-draft-return-target';
import { useDraftConfigStore } from '../runtime/draft-config';
import { resetNewThreadDraft } from '../new-thread/reset-new-thread-draft';
import { markDraftDiscarded } from '../new-thread/discarded-drafts';
import { useDraftNavigationCleanup } from './use-draft-navigation-cleanup';

export interface DraftRowState {
  model: DraftRowModel | null;
  visible: boolean;
  selected: boolean;
  onSelect: () => void;
  onDiscard: () => void;
}

export function useDraftRow(allItems: SessionItem[], filterProjectIds: ReadonlySet<string>): DraftRowState {
  const aui = useAui();
  const newThreadId = useAuiState((s) => s.threads.newThreadId);
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const draftCfg = useDraftConfigStore((s) => (newThreadId ? s.drafts.get(newThreadId) : undefined));

  const model: DraftRowModel | null =
    draftCfg != null && newThreadId != null ? { newThreadId, projectId: draftCfg.projectId } : null;
  const visible = draftRowVisible(model, filterProjectIds);
  const selected = model != null && mainThreadId === model.newThreadId;

  useDraftNavigationCleanup(newThreadId, mainThreadId);

  const onSelect = useCallback(() => {
    if (model != null) aui.threads.switchToThread(model.newThreadId);
  }, [model, aui]);

  const onDiscard = useCallback(() => {
    if (newThreadId == null) return;
    resetNewThreadDraft(newThreadId);
    markDraftDiscarded(newThreadId);
    const { returnThreadId, clear } = useDraftReturnTarget.getState();
    const target = returnThreadId ?? allItems[0]?.id ?? null;
    if (target != null) aui.threads.switchToThread(target);
    clear();
  }, [newThreadId, allItems, aui]);

  return { model, visible, selected, onSelect, onDiscard };
}
