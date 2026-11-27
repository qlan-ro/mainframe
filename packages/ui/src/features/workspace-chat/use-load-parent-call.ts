import { useEffect, useState } from 'react';
import type { ThreadMessage } from '@assistant-ui/react';
import type { AcpChatController } from '@/features/chat/controller/acp-chat-controller';
import type { ChatThreadState } from '@/features/chat/controller/chat-thread-state';
import type { SubagentCall } from './find-subagent-call';

/**
 * The old way, kept for a daemon that cannot answer `history_around`: page the parent back to the call.
 * Every other daemon reads the call by itself (`useOwnSubagentCall`) and never moves the parent's floor.
 */
export function useLoadParentCall(
  controller: AcpChatController,
  state: ChatThreadState,
  messages: readonly ThreadMessage[],
  call: SubagentCall | null,
  target: { toolCallId: string; messageId?: string; nested: boolean; fallback: boolean },
): string | null {
  const [error, setError] = useState<string | null>(null);
  const { toolCallId, messageId } = target;
  const partial = controller.isHistoryContext(toolCallId);
  const ready = state.loadState?.type === 'ready';
  const hasMore = state.historyWindow?.hasMore ?? false;
  const needed = target.fallback && !target.nested && ready && (call == null || partial);
  const exhausted = !hasMore || (!partial && messages.some((message) => message.id === messageId));
  useEffect(() => {
    if (!needed || exhausted) return undefined;
    let cancelled = false;
    void controller.loadEarlierLive(toolCallId).then(
      (found) => {
        if (!cancelled && !found) setError('Not in this transcript');
      },
      (cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load the transcript');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [controller, needed, exhausted, messages, toolCallId]);
  return needed && exhausted ? 'Not in this transcript' : error;
}
