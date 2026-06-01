import { daemonClient } from './client';
import { useChatsStore } from '../store/chats';
import { getActiveProjectId } from '../hooks/useActiveProjectId.js';
import { getDefaultModelForAdapter } from './adapters';
import { createLogger } from './logger';
import { startChat } from './chat-actions';

const log = createLogger('renderer:chat');

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

  const projectId = getActiveProjectId();
  if (!projectId) return;

  void startChat(projectId, 'claude', getDefaultModelForAdapter('claude')).then((chat) => {
    if (chat) ensureResumedAndSend(chat.id, formatted);
    else log.warn('startChat failed; comment not sent');
  });
}

function ensureResumedAndSend(chatId: string, content: string): void {
  const process = useChatsStore.getState().processes.get(chatId);
  if (!process || process.status === 'stopped') {
    daemonClient.resumeChat(chatId);
  }
  daemonClient.sendMessage(chatId, content);
}
