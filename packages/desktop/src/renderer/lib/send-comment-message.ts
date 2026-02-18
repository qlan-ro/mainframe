import { daemonClient } from './client';
import { useChatsStore } from '../store/chats';
import { useProjectsStore } from '../store/projects';

/**
 * Send a comment message to the best available chat.
 * Resolution: explicitChatId -> activeChatId -> create new chat.
 * Ensures the session is resumed before sending.
 */
export function sendCommentMessage(formatted: string, explicitChatId?: string): void {
  const chatId = explicitChatId ?? useChatsStore.getState().activeChatId;

  if (chatId) {
    ensureResumedAndSend(chatId, formatted);
    return;
  }

  const projectId = useProjectsStore.getState().activeProjectId;
  if (!projectId) return;

  const timeout = setTimeout(() => {
    unsub();
    console.warn('[sendCommentMessage] timed out waiting for chat.created');
  }, 5000);

  const unsub = useChatsStore.subscribe((state, prev) => {
    if (state.chats.length > prev.chats.length) {
      const newChat = state.chats.find((c) => !prev.chats.some((p) => p.id === c.id));
      if (newChat) {
        clearTimeout(timeout);
        unsub();
        ensureResumedAndSend(newChat.id, formatted);
      }
    }
  });

  daemonClient.createChat(projectId, 'claude');
}

function ensureResumedAndSend(chatId: string, content: string): void {
  const process = useChatsStore.getState().processes.get(chatId);
  if (!process || process.status === 'stopped') {
    daemonClient.resumeChat(chatId);
  }
  daemonClient.sendMessage(chatId, content);
}
