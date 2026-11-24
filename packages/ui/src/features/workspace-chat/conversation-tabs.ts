/**
 * Opening, finding and closing the workspace's chat and agent tabs (W8, W9).
 *
 * Every secondary conversation opens through here: forks, side chats, delegated
 * tasks, sub-agents, and any session shown beside the one in the chat column.
 * Closing a tab only takes it off screen. The chat, its transcript and its
 * unsent message stay (`draft-keeper`), so reopening is always possible.
 */
import type { ChatTabRole, RunState, RunTab } from '@/store/run-pane';
import { useLayoutStore } from '@/store/layout';
import { isSurfaceLit } from '@/store/layout-placement';

export interface ChatTarget {
  /** The daemon's chat id, which is also the key of its own workspace layout. */
  chatId: string;
  role: ChatTabRole;
  title: string;
}

export interface SubagentTarget {
  /** The chat whose transcript holds the call. */
  chatId: string;
  toolCallId: string;
  /** Absent while the call isn't loaded; the tab loads the history that holds it. */
  messageId?: string;
  title: string;
}

export function chatTab({ chatId, role, title }: ChatTarget): RunTab {
  return { id: `chat-${chatId}`, kind: 'chat', title, chatId, role };
}

function subagentTab({ chatId, toolCallId, messageId, title }: SubagentTarget): RunTab {
  return { id: `agent-${toolCallId}`, kind: 'agent', title, chatId, toolCallId, messageId };
}

function addTab(tab: RunTab, sessionId: string | null): void {
  const store = useLayoutStore.getState();
  if (sessionId == null) store.addRunTab(tab);
  else store.addSessionTab(sessionId, tab);
}

/**
 * Show a chat beside the session (the active one unless named): focuses its tab
 * when it has one. False, and nothing happens, when the chat IS that session: it
 * is already in the chat column.
 */
export function openChatTab(target: ChatTarget, sessionId = useLayoutStore.getState().activeSessionId): boolean {
  if (target.chatId === sessionId) return false;
  addTab(chatTab(target), sessionId);
  return true;
}

/** Show a sub-agent's work beside the session. */
export function openSubagentTab(target: SubagentTarget): void {
  addTab(subagentTab(target), useLayoutStore.getState().activeSessionId);
}

/** A session's panes: the live ones for the active session, the remembered ones for the rest. */
export function sessionRun(sessionId: string): RunState | null {
  const { activeSessionId, run, sessions } = useLayoutStore.getState();
  return sessionId === activeSessionId ? run : (sessions.get(sessionId)?.run ?? null);
}

export function findChatTab(run: RunState | null, chatId: string): { paneId: string; tab: RunTab } | null {
  for (const pane of run?.panes ?? []) {
    const tab = pane.tabs.find((t) => t.kind === 'chat' && t.chatId === chatId);
    if (tab) return { paneId: pane.id, tab };
  }
  return null;
}

/** Takes a chat's tab off the active session's workspace. */
export function closeChatTab(chatId: string): void {
  const { run, closeRunTab } = useLayoutStore.getState();
  const found = findChatTab(run, chatId);
  if (found) closeRunTab(found.paneId, found.tab.id);
}

/** True while the chat's tab is the one showing in its pane, with the workspace open. */
export function useChatTabInFront(chatId: string | null): boolean {
  return useLayoutStore(
    (s) =>
      chatId != null &&
      isSurfaceLit(s.layout, 'workspace') &&
      (s.run?.panes.some((p) => p.tabs.some((t) => t.id === p.active && t.kind === 'chat' && t.chatId === chatId)) ??
        false),
  );
}
