/**
 * Minimal subset of the daemon chat REST API needed for Phase 1.
 * All routes are unauthenticated when called from localhost (daemon auth middleware
 * isLocalhost() bypass confirmed in packages/core/src/server/middleware/auth.ts).
 */
import type { ApiResponse, DisplayMessage, Chat, SessionTuning, ExecutionMode } from '@qlan-ro/mainframe-types';
import { apiBase, fetchJson, postJson, patchJson } from './http';

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
export async function setChatConfig(port: number, chatId: string, body: ChatConfigPatch): Promise<Chat> {
  const json = await patchJson<ApiResponse<Chat>>(`${apiBase(port)}/api/chats/${chatId}/config`, body);
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export async function getChatMessages(port: number, chatId: string): Promise<DisplayMessage[]> {
  const json = await fetchJson<ApiResponse<DisplayMessage[]>>(`${apiBase(port)}/api/chats/${chatId}/messages`);
  if (!json.success) throw new Error(json.error);
  return json.data;
}

/** The chat record (model, effort, planMode, permissionMode, adapterId, isRunning, …). */
export async function getChat(port: number, chatId: string): Promise<Chat> {
  const json = await fetchJson<ApiResponse<Chat>>(`${apiBase(port)}/api/chats/${chatId}`);
  if (!json.success) throw new Error(json.error);
  return json.data;
}

/**
 * Persist a tuning patch (effort + fast/ultracode/adaptiveThinking — the only
 * REST-settable config). Tri-state: undefined skips, null clears, value sets.
 * Returns the updated chat.
 */
export async function setChatTuning(port: number, chatId: string, tuning: SessionTuning): Promise<Chat> {
  const json = await patchJson<ApiResponse<Chat>>(`${apiBase(port)}/api/chats/${chatId}/tuning`, tuning);
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export async function resumeChat(port: number, chatId: string): Promise<void> {
  const json = await postJson<ApiResponse<unknown>>(`${apiBase(port)}/api/chats/${chatId}/resume`);
  if (!json.success) throw new Error(json.error);
}

export async function interruptChat(port: number, chatId: string): Promise<void> {
  const json = await postJson<ApiResponse<unknown>>(`${apiBase(port)}/api/chats/${chatId}/interrupt`);
  if (!json.success) throw new Error(json.error);
}

/** Full (untruncated) output for a tool call, fetched on demand for long results. */
export async function getToolResultContent(port: number, chatId: string, toolUseId: string): Promise<string> {
  const json = await fetchJson<ApiResponse<{ content: string }>>(
    `${apiBase(port)}/api/chats/${chatId}/tool-result/${toolUseId}`,
  );
  if (!json.success) throw new Error(json.error);
  return json.data.content;
}
