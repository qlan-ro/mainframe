import type { AdapterModel, Chat, ResolvedTuning } from '@qlan-ro/mainframe-types';
import { resolveTuning } from './resolve-tuning.js';
import { getProviderConfig } from '../settings/provider-config.js';

interface ResolveDeps {
  db: {
    chats: { get(id: string): Chat | null | undefined };
    settings: { get(ns: string, key: string): string | null };
  };
  adapters: { get(id: string): { listModels(): Promise<AdapterModel[]> } | undefined };
}

/** THE single resolution site. Used by spawn (lifecycle) and live-apply (chat-manager). */
export async function resolveTuningForChat(deps: ResolveDeps, chatId: string): Promise<ResolvedTuning | null> {
  const chat = deps.db.chats.get(chatId);
  if (!chat) return null;
  const adapter = deps.adapters.get(chat.adapterId);
  const models = adapter ? await adapter.listModels() : [];
  const modelId = chat.model ?? '';
  const model: AdapterModel = models.find((m) => m.id === modelId) ?? { id: modelId, label: modelId };
  const provider = getProviderConfig(deps.db, chat.adapterId);
  return resolveTuning(
    { effort: chat.effort, fast: chat.fast, ultracode: chat.ultracode, adaptiveThinking: chat.adaptiveThinking },
    provider,
    model,
  );
}
