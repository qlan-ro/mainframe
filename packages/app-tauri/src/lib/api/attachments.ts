/**
 * Composer attachment upload. Files are uploaded to the daemon's attachment
 * store (POST /api/chats/:id/attachments) which returns stable ids; the message
 * then references those ids (`message.send.attachmentIds`), not the bytes.
 */
import { apiBase, request } from './http';

export interface UploadAttachmentItem {
  name: string;
  mediaType: string;
  data: string; // base64 (no data: prefix)
  sizeBytes?: number;
  kind?: 'image' | 'file';
  originalPath?: string;
}

interface SavedAttachment {
  id: string;
  name: string;
  mediaType: string;
}

/** Upload pending attachments, returning their daemon-assigned ids (upload order). */
export async function uploadAttachments(
  port: number,
  chatId: string,
  attachments: UploadAttachmentItem[],
): Promise<string[]> {
  const { attachments: saved } = await request<{ attachments: SavedAttachment[] }>(
    'POST',
    `${apiBase(port)}/api/chats/${chatId}/attachments`,
    { attachments },
  );
  return saved.map((a) => a.id);
}

export interface LoadedAttachment {
  name: string;
  mediaType: string;
  sizeBytes: number;
  kind: 'image' | 'file';
  data: string; // base64 (no data: prefix)
  originalPath?: string;
}

/** Fetch a single stored attachment's bytes — GET /api/chats/:id/attachments/:attachmentId. */
export const getAttachment = (port: number, chatId: string, attachmentId: string): Promise<LoadedAttachment> =>
  request<LoadedAttachment>(
    'GET',
    `${apiBase(port)}/api/chats/${encodeURIComponent(chatId)}/attachments/${encodeURIComponent(attachmentId)}`,
  );
