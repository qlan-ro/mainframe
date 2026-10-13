import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import { apiBase, authHeaders, request, requestEmpty } from './http';

const path = (chatId: string) => `${apiBase()}/api/chats/${encodeURIComponent(chatId)}/background-tasks`;

export async function listBackgroundTasks(chatId: string): Promise<BackgroundTask[]> {
  const data = await request<{ tasks: BackgroundTask[] }>('GET', path(chatId));
  return data.tasks;
}

export function stopBackgroundTask(chatId: string, taskId: string): Promise<void> {
  return requestEmpty('POST', `${path(chatId)}/${encodeURIComponent(taskId)}/kill`);
}

export function cancelDelegatedTask(chatId: string, taskId: string): Promise<void> {
  return requestEmpty(
    'POST',
    `${apiBase()}/api/chats/${encodeURIComponent(chatId)}/delegated-tasks/${encodeURIComponent(taskId)}/cancel`,
  );
}

export async function readBackgroundTaskOutput(chatId: string, taskId: string): Promise<string> {
  const response = await fetch(`${path(chatId)}/${encodeURIComponent(taskId)}/output?bytes=8192`, {
    headers: authHeaders(),
  });
  if (response.status === 409) return '';
  if (!response.ok) throw new Error(`Output request failed (${response.status})`);
  return response.text();
}
