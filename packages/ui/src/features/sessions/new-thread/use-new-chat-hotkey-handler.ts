/**
 * useNewChatHotkeyHandler — builds the ⌘N/Ctrl+N callback for useNewChatHotkey.
 *
 * One behavior for every view: reset the stale draft and switch to the new
 * thread. With a project pill active, useNewThreadAutoConfig seeds that
 * project's draft on activation; without one, the welcome screen's own picker
 * resolves the project (the old anchored "NEW SESSION IN…" popover is gone).
 */
import { useCallback } from 'react';
import type { AssistantClient } from '@assistant-ui/react';
import { resetNewThreadDraft } from './reset-new-thread-draft';

export function useNewChatHotkeyHandler(aui: AssistantClient): () => void {
  return useCallback(() => {
    resetNewThreadDraft(aui.threads.getState().newThreadId);
    void aui.threads.switchToNewThread();
  }, [aui]);
}
