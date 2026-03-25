import { useChatsStore } from '../store/chats.js';

export function useActiveProjectId(): string | null {
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const chats = useChatsStore((s) => s.chats);

  if (!activeChatId) return null;
  const chat = chats.find((c) => c.id === activeChatId);
  return chat?.projectId ?? null;
}
