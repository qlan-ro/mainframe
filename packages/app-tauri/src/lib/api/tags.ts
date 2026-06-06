/**
 * Tag registry and chat-tag REST API helpers.
 * Routes: GET/POST /api/tags, PATCH/DELETE /api/tags/:name,
 *         GET/PUT /api/chats/:id/tags
 *
 * This is the ONE canonical tags.ts for the sessions feature.
 * All later phases import from here — never re-create it.
 */
import type { Tag, TagColor } from '@qlan-ro/mainframe-types';
import { apiBase, request, requestEmpty } from './http';

/**
 * Patch shape for updateTag.
 * color must be a TagColor (from the palette) — not an arbitrary string.
 */
export interface TagPatch {
  rename?: string;
  color?: TagColor;
}

/** List all registered tags. */
export const listTags = (port: number): Promise<Tag[]> => request<Tag[]>('GET', `${apiBase(port)}/api/tags`);

/**
 * Create a new tag. color is optional; when provided it must be a TagColor.
 * Tag names are lowercased server-side; real 400s are charset/length <2 or >24/reserved mf: prefix.
 */
export function createTag(port: number, name: string, color?: TagColor): Promise<Tag> {
  const body: { name: string; color?: TagColor } = { name };
  if (color !== undefined) body.color = color;
  return request<Tag>('POST', `${apiBase(port)}/api/tags`, body);
}

/**
 * Rename or recolor an existing tag.
 * Recolor is registry-only and does NOT cascade to chat.tags — callers must NOT
 * mirror it across loaded thread customs (only rename/delete cascade).
 */
export function updateTag(port: number, name: string, patch: TagPatch): Promise<Tag> {
  const body: TagPatch = {};
  if (patch.rename !== undefined) body.rename = patch.rename;
  if (patch.color !== undefined) body.color = patch.color;
  return request<Tag>('PATCH', `${apiBase(port)}/api/tags/${name}`, body);
}

/**
 * Delete a tag (cascades in SQLite but emits NO chat.updated events —
 * callers must mirror the removal across loaded thread customs client-side).
 */
export const deleteTag = (port: number, name: string): Promise<void> =>
  requestEmpty('DELETE', `${apiBase(port)}/api/tags/${name}`);

/** Get the tag names applied to a chat. */
export const getChatTags = (port: number, chatId: string): Promise<string[]> =>
  request<string[]>('GET', `${apiBase(port)}/api/chats/${chatId}/tags`);

/**
 * Replace the full tag set for a chat (PUT semantics — always send the complete desired set).
 * Tag names are lowercased server-side; the returned array reflects the stored names.
 */
export const setChatTags = (port: number, chatId: string, tags: string[]): Promise<string[]> =>
  request<string[]>('PUT', `${apiBase(port)}/api/chats/${chatId}/tags`, tags);
