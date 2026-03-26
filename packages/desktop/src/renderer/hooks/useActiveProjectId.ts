import { useChatsStore } from '../store/chats.js';

export function useActiveProjectId(): string | null {
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const chats = useChatsStore((s) => s.chats);

  if (!activeChatId) return null;
  const chat = chats.find((c) => c.id === activeChatId);
  return chat?.projectId ?? null;
}

/** Non-hook equivalent for use in callbacks, event handlers, and subscriptions. */
export function getActiveProjectId(): string | null {
  const { activeChatId, chats } = useChatsStore.getState();
  if (!activeChatId) return null;
  const chat = chats.find((c) => c.id === activeChatId);
  return chat?.projectId ?? null;
}
