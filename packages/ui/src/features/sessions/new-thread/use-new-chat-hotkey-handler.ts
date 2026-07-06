/**
 * useNewChatHotkeyHandler — builds the ⌘N/Ctrl+N callback for useNewChatHotkey.
 *
 * "All" view (no project pill active) → opens the "NEW SESSION IN…" popover
 * (the same anchored picker the sidebar "+" button opens) via the shared
 * useNewSessionPickerTarget store, instead of switching straight to a
 * projectless new thread. A project pill active → unchanged: reset the stale
 * draft and switch to a new thread (useNewThreadAutoConfig seeds that
 * project's draft on activation). See resolveNewChatHotkeyAction for the
 * single seam that decides which branch runs.
 */
import { useCallback } from 'react';
import type { AssistantRuntime } from '@assistant-ui/react';
import { useSessionFilters } from '@/store/session-filters';
import { resetNewThreadDraft } from './reset-new-thread-draft';
import { resolveNewChatHotkeyAction } from './new-chat-hotkey-action';
import { useNewSessionPickerTarget } from '../sidebar/use-new-session-picker-target';

export function useNewChatHotkeyHandler(runtime: AssistantRuntime): () => void {
  const filterProjectId = useSessionFilters((s) => s.filterProjectId);

  return useCallback(() => {
    if (resolveNewChatHotkeyAction(filterProjectId) === 'open-project-picker') {
      useNewSessionPickerTarget.getState().setOpen(true);
      return;
    }
    resetNewThreadDraft(runtime.threads.getState().newThreadId);
    void runtime.threads.switchToNewThread();
  }, [filterProjectId, runtime]);
}
