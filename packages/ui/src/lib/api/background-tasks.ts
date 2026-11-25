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

/** The most the daemon sends of one task's output. */
const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface BackgroundTaskOutput {
  text: string;
  /** The start is left out: the output is longer than the 1 MB the daemon sends. */
  truncated: boolean;
}

export async function readBackgroundTaskOutput(chatId: string, taskId: string): Promise<BackgroundTaskOutput> {
  const response = await fetch(`${path(chatId)}/${encodeURIComponent(taskId)}/output?bytes=${MAX_OUTPUT_BYTES}`, {
    headers: authHeaders(),
  });
  if (response.status === 409) return { text: '', truncated: false };
  if (!response.ok) throw new Error(`Output request failed (${response.status})`);
  return { text: await response.text(), truncated: response.headers.get('x-output-truncated') === 'true' };
}
