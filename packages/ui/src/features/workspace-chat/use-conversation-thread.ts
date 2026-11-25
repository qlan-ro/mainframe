/**
 * The thread context of a conversation shown in a workspace tab: an
 * `ExternalThread` client built from the chat's own controller, which the tab
 * keeps loaded, live and attached for as long as it is mounted. Holds are
 * counted on the controller, so the chat column, a task row and a tab can show
 * the same chat at once.
 *
 * With `itemId`, `threadListItem` is rebound too, so everything below resolves
 * to the tab's chat (composer, gates, header). A side chat has no list item and
 * leaves it unbound: see `side-chat-scope`.
 *
 * ONE provider carries both scopes. They cannot be nested: an inner
 * `extends={aui}` chains to the ROOT context and would drop the outer rebinding.
 */
import { useCallback, useEffect, useMemo } from 'react';
import { AuiConfig, ExternalThread, type AppendMessage } from '@assistant-ui/react';
import { Derived } from '@assistant-ui/store';
import type { AcpChatController } from '@/features/chat/controller/acp-chat-controller';
import { buildChatExtras, isRunningFromState, useChatExtrasState } from '@/features/chat/runtime/chat-extras';
import { CHAT_ATTACHMENT_ADAPTER, useControllerState } from '@/features/chat/runtime/use-chat-thread-runtime';
import { useNativeThreadMessages } from '@/features/chat/runtime/use-native-thread-messages';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';

/** Loaded, live, and attached to its transcript stream while the caller is mounted. */
export function useKeepAttached(controller: AcpChatController | null): void {
  useEffect(() => {
    if (controller == null) return undefined;
    void controller.load();
    const stop = controller.subscribeLive();
    const release = controller.holdActive();
    return () => {
      release();
      stop();
    };
  }, [controller]);
}

export function useConversationThread(controller: AcpChatController, itemId?: string) {
  const port = useDaemonPort();
  const state = useControllerState(controller);
  useKeepAttached(controller);

  const messages = useNativeThreadMessages(state);
  const isRunning = isRunningFromState(state);
  const extrasState = useChatExtrasState(state);
  const extras = useMemo(() => buildChatExtras(controller, port, extrasState), [controller, port, extrasState]);

  // A tab only ever holds a chat the daemon knows, so send needs no createForLocal branch.
  const onNew = useCallback(
    (message: AppendMessage) => {
      void controller.sendMessage(message);
    },
    [controller],
  );

  return useMemo(() => {
    const thread = ExternalThread({
      messages,
      isRunning,
      isLoading: state.loadState.type === 'loading',
      extras,
      onNew,
      onCancel: () => {
        void controller.cancel();
      },
      attachmentAdapter: CHAT_ATTACHMENT_ADAPTER,
    });
    if (itemId == null) return AuiConfig({ thread });
    return AuiConfig({
      thread,
      threadListItem: Derived({
        source: 'threads',
        query: { type: 'id', id: itemId },
        get: (client) => client.threads.item({ id: itemId }),
      }),
    });
  }, [messages, isRunning, state.loadState.type, extras, onNew, controller, itemId]);
}
