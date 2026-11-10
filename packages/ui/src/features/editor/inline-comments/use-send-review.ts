import { useCallback } from 'react';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { chatControllerRegistry } from '@/features/sessions/runtime/chat-controller-registry';
import { formatReview, type LineCommentInput } from '@/lib/editor/format-line-comment';
import { useActiveDraftConfig } from '@/features/sessions/use-active-draft-config';
import { useAui, type AppendMessage } from '@assistant-ui/react';

/**
 * 'no-session' signals the caller to keep every note and draft intact — the
 * send never reached the daemon, so nothing was submitted to clear.
 */
export type SendReviewOutcome = 'sent' | 'no-session' | 'empty';

export function useSendReview() {
  const port = useDaemonPort();
  const { chatId } = useActiveIdentity();
  const draft = useActiveDraftConfig();
  const aui = useAui();

  return useCallback(
    async (filePath: string, items: LineCommentInput[]): Promise<SendReviewOutcome> => {
      if (!chatId && !draft) {
        console.warn('[editor] no active chatId, skipping review send');
        return 'no-session';
      }
      if (items.length === 0) return 'empty';

      // Draft (`__LOCALID_*`, no messages yet): create the daemon chat through
      // aui's awaitable initialize seam so the item gets its remoteId stamped.
      let targetId = chatId;
      if (!targetId) {
        const { remoteId } = await aui.threadListItem().initialize();
        targetId = remoteId;
      }
      const controller = chatControllerRegistry.getOrCreate(targetId, port);

      const message: AppendMessage = {
        role: 'user',
        content: [{ type: 'text', text: formatReview(filePath, items) }],
        attachments: [],
        metadata: { custom: {} },
        createdAt: new Date(),
        parentId: null,
        sourceId: null,
        runConfig: undefined,
      };

      await controller.sendMessage(message);
      return 'sent';
    },
    [chatId, draft, aui, port],
  );
}
