/**
 * Minimal subset of the daemon chat REST API needed for Phase 1.
 * All routes are unauthenticated when called from localhost (daemon auth middleware
 * isLocalhost() bypass confirmed in packages/core/src/server/middleware/auth.ts).
 */
import type { ApiResponse, DisplayMessage } from '@qlan-ro/mainframe-types';
import { apiBase, fetchJson, postJson } from './http';

export async function getChatMessages(port: number, chatId: string): Promise<DisplayMessage[]> {
  const json = await fetchJson<ApiResponse<DisplayMessage[]>>(`${apiBase(port)}/api/chats/${chatId}/messages`);
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
