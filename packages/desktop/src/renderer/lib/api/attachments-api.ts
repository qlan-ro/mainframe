import { fetchJson, API_BASE } from './http';
import { createLogger } from '../logger';

const log = createLogger('api');

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
  return fetchJson(`${API_BASE}/api/chats/${chatId}/attachments/${attachmentId}`);
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
