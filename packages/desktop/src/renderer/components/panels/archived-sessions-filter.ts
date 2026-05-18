import type { Chat } from '@qlan-ro/mainframe-types';

export function filterArchivedChats(chats: Chat[], filterProjectId: string | null): Chat[] {
  return chats
    .filter((c) => c.status === 'archived' && (filterProjectId === null || c.projectId === filterProjectId))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}
