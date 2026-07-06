/**
 * store/session-todos.ts — per-chat session todos (the agent's TodoWrite list).
 *
 * Fed by the daemon's existing `todos.updated` WS event — no contract change.
 * The daemon re-emits `todos.updated` with the persisted `chat.todos` on every
 * (re)subscribe (`lifecycle-manager.resumeChat`), so this store seeds correctly
 * for chats opened from history, not just live ones.
 *
 * Global + always-on (mirrors desktop's `useChatsStore.todos`): the subscriber
 * is installed once at the app root so the resumeChat seed is never missed by a
 * Context tab that mounts after it fires. The Context panel reads it via the
 * `useSessionTodos` selector.
 */
import { create } from 'zustand';
import type { TodoItem } from '@qlan-ro/mainframe-types';
import { daemonWs } from '@/lib/daemon/ws-client';

interface SessionTodosState {
  byChat: Record<string, TodoItem[]>;
}

export const useSessionTodosStore = create<SessionTodosState>(() => ({ byChat: {} }));

const EMPTY: readonly TodoItem[] = [];

/** The given chat's session todos (stable empty array when none are known). */
export function useSessionTodos(chatId: string | undefined): readonly TodoItem[] {
  return useSessionTodosStore((s) => (chatId ? s.byChat[chatId] : undefined)) ?? EMPTY;
}

/**
 * Register the single always-on `todos.updated` subscriber. Idempotent per call
 * site; returns the unsubscribe. Mount once at the app root.
 */
export function installSessionTodosSubscriber(): () => void {
  return daemonWs.onEvent((event) => {
    if (event.type !== 'todos.updated') return;
    useSessionTodosStore.setState((s) => ({ byChat: { ...s.byChat, [event.chatId]: event.todos } }));
  });
}
