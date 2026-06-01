import type { ApiResponse } from '@qlan-ro/mainframe-types';
import { fetchJson, API_BASE } from './http';
import { createLogger } from '../logger';

const log = createLogger('renderer:api');

export async function getAttachment(
  chatId: string,
  attachmentId: string,
): Promise<{
  name: string;
  mediaType: string;
  sizeBytes: number;
  kind: 'image' | 'file';
  data: string;
  originalPath?: string;
}> {
  const json = await fetchJson<
    ApiResponse<{
      name: string;
      mediaType: string;
      sizeBytes: number;
      kind: 'image' | 'file';
      data: string;
      originalPath?: string;
    }>
  >(`${API_BASE}/api/chats/${chatId}/attachments/${attachmentId}`);
  if (!json.success) throw new Error(json.error);
  return json.data;
}

export async function uploadAttachments(
  chatId: string,
  attachments: {
    name: string;
    mediaType: string;
    sizeBytes: number;
    kind: 'image' | 'file';
    data: string;
    originalPath?: string;
  }[],
): Promise<
  {
    id: string;
    name: string;
    mediaType: string;
    sizeBytes: number;
    kind: 'image' | 'file';
    originalPath?: string;
  }[]
> {
  log.info('uploadAttachments', { chatId, count: attachments.length });
  const res = await fetch(`${API_BASE}/api/chats/${chatId}/attachments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attachments }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Upload failed: ${res.status}`);
  }
  const json = await res.json();
  return json.data.attachments;
}
