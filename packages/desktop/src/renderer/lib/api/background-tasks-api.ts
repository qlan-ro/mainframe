import type { BackgroundTask } from '@qlan-ro/mainframe-types';
import { API_BASE } from './http.js';

export async function listBackgroundTasks(chatId: string): Promise<{ tasks: BackgroundTask[] }> {
  const res = await fetch(`${API_BASE}/api/chats/${encodeURIComponent(chatId)}/background-tasks`);
  if (!res.ok) throw new Error(`listBackgroundTasks ${res.status}`);
  return res.json();
}

export async function getBackgroundTaskOutput(chatId: string, taskId: string, bytes?: number): Promise<string> {
  const url = new URL(
    `${API_BASE}/api/chats/${encodeURIComponent(chatId)}/background-tasks/${encodeURIComponent(taskId)}/output`,
  );
  if (bytes !== undefined) url.searchParams.set('bytes', String(bytes));
  const res = await fetch(url);
  if (res.status === 409) {
    const body = (await res.json().catch(() => ({}))) as { reason?: string };
    throw new Error(`no_output: ${body.reason ?? 'unknown'}`);
  }
  if (!res.ok) throw new Error(`getBackgroundTaskOutput ${res.status}`);
  return res.text();
}

export async function killBackgroundTaskApi(chatId: string, taskId: string): Promise<void> {
  const res = await fetch(
    `${API_BASE}/api/chats/${encodeURIComponent(chatId)}/background-tasks/${encodeURIComponent(taskId)}/kill`,
    { method: 'POST' },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`killBackgroundTask ${res.status}: ${body.error ?? 'unknown'}`);
  }
}
