/**
 * The worktree and project of the chat a tab shows, so its file links open and
 * copy its own files whatever the conversation's are. A side chat works in its
 * parent's. Nothing is provided for a chat the list does not have: its paths
 * then resolve as the conversation's do.
 */
import { useMemo, type ReactNode } from 'react';
import { useAuiState } from '@assistant-ui/react';
import { findByChatId } from '@/features/chat/orchestration/use-session-items';
import { getActiveDaemon } from '@/lib/daemon/active-daemon';
import { activeLaunchScope } from '@/lib/launch-scope';
import { ChatFileBasesContext, ChatFileRevealContext } from '@/features/chat/tools/chat-file-bases';
import { useProjects } from '@/features/sessions/use-projects';
import type { SessionCustom } from '@/features/sessions/view-model/chat-to-thread-custom';
import { parentOfSideChat } from '@/features/side-chat/side-chat-ids';

export function OwnFiles({ chatId, children }: { chatId: string; children: ReactNode }) {
  const custom = useAuiState(
    (s) => findByChatId(s.threads.threadItems, parentOfSideChat(chatId) ?? chatId)?.custom as SessionCustom | undefined,
  );
  const { projects } = useProjects();
  const worktreePath = custom?.worktreePath;
  const projectPath = projects.find((project) => project.id === custom?.projectId)?.path;
  const bases = useMemo(
    () => (worktreePath == null && projectPath == null ? null : { worktreePath, projectPath }),
    [worktreePath, projectPath],
  );
  const scopeKey = activeLaunchScope(custom?.noProject ? undefined : custom?.projectId, worktreePath, projectPath);
  const daemonId = getActiveDaemon().id;
  const scope = useMemo(() => (scopeKey ? { scopeKey, daemonId } : null), [scopeKey, daemonId]);
  return (
    <ChatFileRevealContext.Provider value={scope}>
      <ChatFileBasesContext.Provider value={bases}>{children}</ChatFileBasesContext.Provider>
    </ChatFileRevealContext.Provider>
  );
}
