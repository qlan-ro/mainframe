import type { Project, Chat, ChatMessage, AdapterInfo } from '@mainframe/types';
import { postJson, deleteRequest, API_BASE } from './http';
import { createLogger } from '../logger';

const log = createLogger('renderer:api');

export async function getProjects(): Promise<Project[]> {
  const res = await fetch(`${API_BASE}/api/projects`);
  const json = await res.json();
  return json.data;
}

export async function createProject(path: string): Promise<{ project: Project; alreadyExists: boolean }> {
  log.info('createProject', { path });
  const res = await fetch(`${API_BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (res.status === 409) {
    const json = await res.json();
    return { project: json.data as Project, alreadyExists: true };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return { project: json.data as Project, alreadyExists: false };
}

export async function removeProject(id: string): Promise<void> {
  log.info('removeProject', { id });
  await deleteRequest(`${API_BASE}/api/projects/${id}`);
}

export async function getChats(projectId: string): Promise<Chat[]> {
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/chats`);
  const json = await res.json();
  return json.data;
}

export async function archiveChat(chatId: string): Promise<void> {
  log.info('archiveChat', { chatId });
  await postJson(`${API_BASE}/api/chats/${chatId}/archive`);
}

export async function getChatMessages(chatId: string): Promise<ChatMessage[]> {
  const res = await fetch(`${API_BASE}/api/chats/${chatId}/messages`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.data;
}

export async function getAdapters(): Promise<AdapterInfo[]> {
  const res = await fetch(`${API_BASE}/api/adapters`);
  const json = await res.json();
  return json.data;
}
