import type { ChatServiceAPI, ChatSummary, PluginManifest, DaemonEvent } from '@mainframe/types';
import type { DatabaseManager } from '../../db/index.js';

export function buildChatService(
  manifest: PluginManifest,
  db: DatabaseManager,
  emitEvent: (event: DaemonEvent) => void,
): ChatServiceAPI {
  const has = (cap: string) => manifest.capabilities.includes(cap as never);

  return {
    async listChats(projectId: string): Promise<ChatSummary[]> {
      const chats = db.chats.list(projectId);
      return chats.map((c) => ({
        id: c.id,
        title: c.title ?? null,
        projectId: c.projectId,
        adapterId: c.adapterId,
        createdAt: c.createdAt,
        totalCost: c.totalCost,
      }));
    },

    async getChatById(chatId: string): Promise<ChatSummary | null> {
      const chat = db.chats.get(chatId);
      if (!chat) return null;
      return {
        id: chat.id,
        title: chat.title ?? null,
        projectId: chat.projectId,
        adapterId: chat.adapterId,
        createdAt: chat.createdAt,
        totalCost: chat.totalCost,
      };
    },

    ...(has('chat:read:content')
      ? {
          async getMessages() {
            // Message history lives in adapter session — not available via DB alone
            return [];
          },
        }
      : {}),

    ...(has('chat:create')
      ? {
          async createChat({ projectId, adapterId, model }) {
            const chat = db.chats.create(projectId, adapterId ?? 'claude', model);
            emitEvent({ type: 'chat.created', chat });
            return { chatId: chat.id };
          },
        }
      : {}),
  };
}
