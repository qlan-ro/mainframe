/**
 * The chats the workspace is showing right now, beside the one in the chat
 * column, by every id a chat answers to (its thread item's and the daemon's).
 *
 * - `held`: some tab reads the chat's controller, so it must not be released
 *   (`use-offload-release`). Every open tab, hidden ones and sub-agents included.
 * - `composing`: a tab has the chat's composer (`use-chat-runtime-hook`). Chat
 *   tabs only: a sub-agent's tab reads its parent's chat and has no composer.
 * - `viewed`: the user can see it, so it gets no unread dot
 *   (`use-session-list-router`).
 */
import { useEffect } from 'react';
import { create } from 'zustand';

interface MountedConversations {
  held: ReadonlySet<string>;
  composing: ReadonlySet<string>;
  viewed: ReadonlySet<string>;
}

export const useMountedConversations = create<MountedConversations>(() => ({
  held: new Set(),
  composing: new Set(),
  viewed: new Set(),
}));

type SetName = keyof MountedConversations;

const counts: Record<SetName, Map<string, number>> = { held: new Map(), composing: new Map(), viewed: new Map() };

function shift(name: SetName, ids: readonly string[], by: 1 | -1): void {
  const map = counts[name];
  for (const id of ids) {
    const next = (map.get(id) ?? 0) + by;
    if (next > 0) map.set(id, next);
    else map.delete(id);
  }
  useMountedConversations.setState({ [name]: new Set(map.keys()) });
}

function useMember(name: SetName, itemId: string, chatId: string, member: boolean): void {
  useEffect(() => {
    if (!member) return undefined;
    const ids = [...new Set([itemId, chatId])];
    shift(name, ids, 1);
    return () => shift(name, ids, -1);
  }, [name, itemId, chatId, member]);
}

/** Declares a chat tab's chat for as long as the caller is mounted. */
export function useDeclareConversation(itemId: string, chatId: string, viewed: boolean): void {
  useMember('held', itemId, chatId, true);
  useMember('composing', itemId, chatId, true);
  useMember('viewed', itemId, chatId, viewed);
}

/** Declares that the caller reads a chat's controller without showing the chat. */
export function useHoldConversation(chatId: string): void {
  useMember('held', chatId, chatId, true);
}
