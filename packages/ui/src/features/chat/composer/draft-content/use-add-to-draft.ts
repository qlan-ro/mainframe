/**
 * useAddToDraft — what the workspace adds to the message being written:
 * preview captures and code annotations (C14). False when there is no message
 * to add to, so the caller keeps what it has.
 */
import { useCallback } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { mfToast } from '@/lib/toast';
import type { SessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import { useActiveThreadId } from '../../runtime/use-active-thread-id';
import { useDraftContent, type NewDraftItem } from './draft-content-store';

export function useAddToDraft(): (items: readonly NewDraftItem[]) => boolean {
  const threadId = useActiveThreadId();
  const readOnly = useAuiState((s) => (s.threadListItem?.custom as SessionCustom | undefined)?.delegation != null);

  return useCallback(
    (items) => {
      if (items.length === 0) return true;
      if (threadId == null || readOnly) {
        mfToast.warning(readOnly ? 'This session is read-only' : 'Open a session first', {
          description: 'There is no message to add this to.',
        });
        return false;
      }
      useDraftContent.getState().add(threadId, items);
      // Its tile says so when the composer is on screen.
      if (document.querySelector('[data-mf-composer-input]') == null) mfToast.success('Added to your message');
      return true;
    },
    [threadId, readOnly],
  );
}
