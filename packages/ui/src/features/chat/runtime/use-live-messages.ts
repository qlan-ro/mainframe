import { useMemo, useSyncExternalStore } from 'react';
import { useAuiState, type ThreadMessage } from '@assistant-ui/react';
import { chatControllerRegistry } from '@/features/sessions/runtime/chat-controller-registry';
import { projectChatThreadMessages } from '../controller/project-messages';
import { useChatExtras } from './chat-extras';

const noop = () => () => undefined;

/**
 * The chat's live transcript. The thread's own messages are the live window except while the reader
 * is in a window around a jump target, when they are that window: the session panel's Activity and
 * the gate queue describe what the chat is doing, so they read the live window through this.
 */
export function useLiveMessages(): readonly ThreadMessage[] {
  const shown = useAuiState((s) => s.thread.messages);
  const extras = useChatExtras();
  const away = extras?.state.historyWindow?.detached != null;
  const controller = away && extras ? chatControllerRegistry.get(extras.state.chatId) : undefined;
  const live = useSyncExternalStore(
    controller ? (listener) => controller.subscribeState(listener) : noop,
    () => controller?.getState().messages,
  );
  const projected = useMemo(
    () => (controller && live ? projectChatThreadMessages({ ...controller.getState(), windowMessages: null }) : null),
    // `live` is the controller's own messages: a new one is a new live transcript.

    [controller, live],
  );
  return projected ?? shown;
}
