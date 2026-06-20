import { useCallback } from 'react';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { chatControllerRegistry } from '@/features/sessions/runtime/chat-controller-registry';
import { formatCaptures, type CaptureLike } from '@/features/run/format-captures';
import type { AppendMessage } from '@assistant-ui/react';

export function useSendCaptures() {
  const port = useDaemonPort();
  const { chatId } = useActiveIdentity();

  return useCallback(
    async (captures: ReadonlyArray<CaptureLike>) => {
      if (!chatId) {
        console.warn('[preview] no active chatId, skipping send');
        return;
      }
      if (captures.length === 0) return;

      const { markdown, attachments } = formatCaptures(captures);
      if (attachments.length === 0) return;

      const controller = chatControllerRegistry.getOrCreate(chatId, port);

      const message: AppendMessage = {
        role: 'user',
        content: [{ type: 'text', text: markdown }],
        attachments: attachments.map((att) => ({
          id: att.name,
          type: 'image' as const,
          name: att.name,
          status: { type: 'complete' as const },
          content: [{ type: 'image' as const, image: `data:${att.mediaType};base64,${att.data}` }],
        })),
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
