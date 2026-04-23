import type { Project } from '@qlan-ro/mainframe-types';
import { removeProject } from './api';
import { useChatsStore, useProjectsStore } from '../store';
import { useTabsStore } from '../store/tabs';
import { useToastStore } from '../store/toasts';
import { deleteDraft } from '../components/chat/assistant-ui/composer/composer-drafts.js';
import { createLogger } from './logger';

const log = createLogger('renderer:delete-project');

export async function deleteProjectWithCleanup(project: Project): Promise<void> {
  const confirmed = window.confirm(
    `Delete project "${project.name}"?\n\nThis will stop all its sessions and remove the project from the database. Files on disk are NOT affected.\n\nThis cannot be undone.`,
  );
  if (!confirmed) return;

  const { add: addToast } = useToastStore.getState();

  try {
    await removeProject(project.id);
    const { filterProjectId, activeChatId, chats, removeChat, setActiveChat, setFilterProjectId } =
      useChatsStore.getState();
    const projectChatIds = new Set(chats.filter((c) => c.projectId === project.id).map((c) => c.id));
    for (const chatId of projectChatIds) {
      removeChat(chatId);
      deleteDraft(chatId);
      useTabsStore.getState().closeTab(`chat:${chatId}`);
    }
    if (filterProjectId === project.id) {
      setFilterProjectId(null);
    }
    if (activeChatId && projectChatIds.has(activeChatId)) {
      setActiveChat(null);
    }
    useProjectsStore.getState().removeProject(project.id);
    addToast('success', 'Project deleted', project.name);
  } catch (err) {
    log.warn('delete project failed', { err: String(err) });
    addToast('error', 'Failed to delete project', String(err));
  }
}
