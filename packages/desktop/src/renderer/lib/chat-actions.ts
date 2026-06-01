import type { Chat, ExecutionMode } from '@qlan-ro/mainframe-types';
import { createChat as createChatRest } from './api/chats-api';
import { daemonClient } from './client';
import { useChatsStore } from '../store/chats';
import { useTabsStore } from '../store/tabs';
import { createLogger } from './logger';

const log = createLogger('renderer:chat-actions');

export async function startChat(
  projectId: string,
  adapterId: string,
  model?: string,
  permissionMode?: ExecutionMode,
  attachWorktree?: { worktreePath: string; branchName: string },
): Promise<Chat | null> {
  try {
    const chat = await createChatRest({
      projectId,
      adapterId,
      model,
      permissionMode,
      worktreePath: attachWorktree?.worktreePath,
      branchName: attachWorktree?.branchName,
    });
    useChatsStore.getState().addChat(chat);
    useChatsStore.getState().setActiveChat(chat.id);
    useTabsStore.getState().openChatTab(chat.id, chat.title);
    daemonClient.subscribe(chat.id);
    // Return the created chat so callers act on THIS chat's id rather than
    // inferring it from global activeChatId (which is wrong on failure or when
    // creates overlap / the user switches chats during the await).
    return chat;
  } catch (err) {
    log.warn('startChat failed', { err: String(err) });
    return null;
  }
}
