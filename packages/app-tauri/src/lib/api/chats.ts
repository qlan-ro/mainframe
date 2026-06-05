/**
 * Minimal subset of the daemon chat REST API needed for Phase 1.
 * All routes are unauthenticated when called from localhost (daemon auth middleware
 * isLocalhost() bypass confirmed in packages/core/src/server/middleware/auth.ts).
 */
import type { DisplayMessage, Chat, SessionTuning, ExecutionMode } from '@qlan-ro/mainframe-types';
import { apiBase, request, requestEmpty } from './http';

/** Body for PATCH /api/chats/:id/config — adapter / model / permission / plan. */
export interface ChatConfigPatch {
  adapterId?: string;
  model?: string;
  permissionMode?: ExecutionMode;
  planMode?: boolean;
}

/**
 * Set adapter / model / permission-mode / plan-mode (the config the daemon
 * applies to the next run). Mirrors the desktop `updateChatConfig` REST call.
 * Returns the updated chat.
 */
export const setChatConfig = (port: number, chatId: string, body: ChatConfigPatch): Promise<Chat> =>
  request<Chat>('PATCH', `${apiBase(port)}/api/chats/${chatId}/config`, body);

export const getChatMessages = (port: number, chatId: string): Promise<DisplayMessage[]> =>
  request<DisplayMessage[]>('GET', `${apiBase(port)}/api/chats/${chatId}/messages`);

/** The chat record (model, effort, planMode, permissionMode, adapterId, isRunning, …). */
export const getChat = (port: number, chatId: string): Promise<Chat> =>
  request<Chat>('GET', `${apiBase(port)}/api/chats/${chatId}`);

/**
 * Persist a tuning patch (effort + fast/ultracode/adaptiveThinking — the only
 * REST-settable config). Tri-state: undefined skips, null clears, value sets.
 * Returns the updated chat.
 */
export const setChatTuning = (port: number, chatId: string, tuning: SessionTuning): Promise<Chat> =>
  request<Chat>('PATCH', `${apiBase(port)}/api/chats/${chatId}/tuning`, tuning);

export const resumeChat = (port: number, chatId: string): Promise<void> =>
  requestEmpty('POST', `${apiBase(port)}/api/chats/${chatId}/resume`);

export const interruptChat = (port: number, chatId: string): Promise<void> =>
  requestEmpty('POST', `${apiBase(port)}/api/chats/${chatId}/interrupt`);

/** Edit a queued message's text (it stays queued; sends after the current run). */
export const editQueuedMessage = (port: number, chatId: string, messageId: string, content: string): Promise<void> =>
  requestEmpty('PATCH', `${apiBase(port)}/api/chats/${chatId}/queue/${messageId}`, { content });

/** Cancel (remove) a queued message before it sends. */
export const cancelQueuedMessage = (port: number, chatId: string, messageId: string): Promise<void> =>
  requestEmpty('DELETE', `${apiBase(port)}/api/chats/${chatId}/queue/${messageId}`);

/** Full (untruncated) output for a tool call, fetched on demand for long results. */
export async function getToolResultContent(port: number, chatId: string, toolUseId: string): Promise<string> {
  const { content } = await request<{ content: string }>(
    'GET',
    `${apiBase(port)}/api/chats/${chatId}/tool-result/${toolUseId}`,
  );
  return content;
}
