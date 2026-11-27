import { useCallback, useSyncExternalStore } from 'react';
import { chatControllerRegistry } from '@/features/sessions/runtime/chat-controller-registry';
import type { AcpChatController } from '../controller/acp-chat-controller';
import { useChatExtras } from './chat-extras';

export const noSubscription = () => () => undefined;

export function useChatController(): AcpChatController | undefined {
  const chatId = useChatExtras()?.state.chatId;
  return chatId ? chatControllerRegistry.get(chatId) : undefined;
}

/**
 * Whether the transcript shows a window around a jump target. It reads the controller's own
 * `windowMessages`, which lands in the same dispatch as the window itself (the history state that
 * says `detached` follows a render later), and re-renders only when that answer changes.
 */
export function useAwayFromTail(): boolean {
  const controller = useChatController();
  const subscribe = useCallback(
    (listener: () => void) => (controller ? controller.subscribeState(listener) : noSubscription()),
    [controller],
  );
  const snapshot = useCallback(() => controller?.getState().windowMessages != null, [controller]);
  return useSyncExternalStore(subscribe, snapshot);
}
