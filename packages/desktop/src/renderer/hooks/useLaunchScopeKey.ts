import { useChatsStore } from '../store/chats.js';
import { useProjectsStore } from '../store/projects.js';
import { buildLaunchScope } from '../lib/launch-scope.js';

/**
 * Derives the launch scope key for the active chat.
 * Uses the chat's worktreePath if set, otherwise falls back to the project root path.
 */
export function useLaunchScopeKey(): string | null {
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const chat = useChatsStore((s) => {
    if (!s.activeChatId) return null;
    return s.chats.find((c) => c.id === s.activeChatId) ?? null;
  });
  const project = useProjectsStore((s) => {
    if (!chat?.projectId) return null;
    return s.projects.find((p) => p.id === chat.projectId) ?? null;
  });

  if (!activeChatId || !chat?.projectId || !project) return null;
  const effectivePath = chat.worktreePath ?? project.path;
  return buildLaunchScope(chat.projectId, effectivePath);
}
