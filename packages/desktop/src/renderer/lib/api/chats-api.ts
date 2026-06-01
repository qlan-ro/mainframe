import type { ApiResponse, Chat, ExecutionMode } from '@qlan-ro/mainframe-types';
import { postJson, patchJson, deleteRequest, fetchJson, API_BASE } from './http';

export async function getChat(chatId: string): Promise<Chat> {
  const json = await fetchJson<ApiResponse<Chat>>(`${API_BASE}/api/chats/${chatId}`);
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export async function createChat(body: {
  projectId: string;
  adapterId: string;
  model?: string;
  permissionMode?: ExecutionMode;
  worktreePath?: string;
  branchName?: string;
}): Promise<Chat> {
  const json = await postJson<ApiResponse<Chat>>(`${API_BASE}/api/chats`, body);
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export async function updateChatConfig(
  chatId: string,
  body: {
    adapterId?: string;
    model?: string;
    permissionMode?: ExecutionMode;
    planMode?: boolean;
  },
): Promise<Chat> {
  const json = await patchJson<ApiResponse<Chat>>(`${API_BASE}/api/chats/${chatId}/config`, body);
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export async function interruptChatRest(chatId: string): Promise<void> {
  const json = await postJson<ApiResponse<unknown>>(`${API_BASE}/api/chats/${chatId}/interrupt`);
  if (!json.success) throw new Error(json.error);
}

export async function resumeChatRest(chatId: string): Promise<void> {
  const json = await postJson<ApiResponse<unknown>>(`${API_BASE}/api/chats/${chatId}/resume`);
  if (!json.success) throw new Error(json.error);
}

export async function editQueuedMessageRest(chatId: string, messageId: string, content: string): Promise<void> {
  const json = await patchJson<ApiResponse<unknown>>(`${API_BASE}/api/chats/${chatId}/queue/${messageId}`, { content });
  if (!json.success) throw new Error(json.error);
}

export async function cancelQueuedMessageRest(chatId: string, messageId: string): Promise<void> {
  await deleteRequest(`${API_BASE}/api/chats/${chatId}/queue/${messageId}`);
}
