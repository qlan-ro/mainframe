import type { Tag, TagColor } from '@qlan-ro/mainframe-types';
import { API_BASE } from './http';
import { createLogger } from '../logger';

const log = createLogger('renderer:api');

export async function listTags(): Promise<Tag[]> {
  const res = await fetch(`${API_BASE}/api/tags`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).data;
}

export async function createTag(name: string, color?: TagColor): Promise<Tag> {
  log.info('createTag', { name, color });
  const res = await fetch(`${API_BASE}/api/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, color }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()).data;
}

export async function updateTag(name: string, patch: { rename?: string; color?: TagColor }): Promise<Tag> {
  log.info('updateTag', { name, patch });
  const res = await fetch(`${API_BASE}/api/tags/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()).data;
}

export async function deleteTag(name: string): Promise<void> {
  log.info('deleteTag', { name });
  const res = await fetch(`${API_BASE}/api/tags/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function getChatTags(chatId: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/chats/${chatId}/tags`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()).data;
}

export async function setChatTags(chatId: string, tags: string[]): Promise<string[]> {
  log.info('setChatTags', { chatId, tags });
  const res = await fetch(`${API_BASE}/api/chats/${chatId}/tags`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()).data;
}
