import { useCallback } from 'react';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { chatControllerRegistry } from '@/features/sessions/runtime/chat-controller-registry';
import { formatReview, type LineCommentInput } from '@/lib/editor/format-line-comment';
import type { AppendMessage } from '@assistant-ui/react';

export function useSendReview() {
  const port = useDaemonPort();
  const { chatId } = useActiveIdentity();

  return useCallback(
    async (filePath: string, items: LineCommentInput[]) => {
      if (!chatId) {
        console.warn('[editor] no active chatId, skipping review send');
        return;
      }
      if (items.length === 0) return;

      const controller = chatControllerRegistry.getOrCreate(chatId, port);

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
    },
    [chatId, port],
  );
}
