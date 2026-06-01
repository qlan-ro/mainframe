import type { ExecutionMode } from '@qlan-ro/mainframe-types';
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
): Promise<void> {
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
  } catch (err) {
    log.warn('startChat failed', { err: String(err) });
  }
}
