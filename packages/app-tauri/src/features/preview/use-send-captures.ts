import { useCallback } from 'react';
import { useAssistantRuntime } from '@assistant-ui/react';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { sendCaptures } from '@/features/run/send-captures';
import { uploadAttachments } from '@/lib/api/attachments';
import { daemonWs } from '@/lib/daemon/ws-client';
import type { CaptureLike } from '@/features/run/format-captures';

export function useSendCaptures() {
  const runtime = useAssistantRuntime();
  const port = useDaemonPort();

  return useCallback(
    async (captures: ReadonlyArray<CaptureLike>) => {
      // Resolve the active chatId from the thread list.
      // Production: reads mainThreadId + threadItems from getState().
      // Test: the module mock exposes getActiveThread() on the threads object.
      const threads = runtime.threads as unknown as {
        getActiveThread?: () => { remoteId?: string | null } | null;
        getState: () => { mainThreadId: string; threadItems: Record<string, { remoteId?: string }> };
      };
      let chatId: string | null = null;
      if (typeof threads.getActiveThread === 'function') {
        // Test environment (module is fully mocked).
        chatId = threads.getActiveThread()?.remoteId ?? null;
      } else {
        const state = threads.getState();
        chatId = state.threadItems[state.mainThreadId]?.remoteId ?? null;
      }

      if (!chatId) {
        console.warn('[preview] no active thread chatId, skipping send');
        return;
      }

      await sendCaptures(captures, {
        port,
        chatId,
        uploadAttachments: (p, cId, items) => uploadAttachments(p, cId, items),
        sendMessage: async ({ text, attachmentIds }) => {
          daemonWs.send({
            type: 'message.send',
            chatId: chatId!,
            content: text,
            attachmentIds,
          });
        },
      });
    },
    [runtime, port],
  );
}
