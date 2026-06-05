/**
 * Composer attachment upload. Files are uploaded to the daemon's attachment
 * store (POST /api/chats/:id/attachments) which returns stable ids; the message
 * then references those ids (`message.send.attachmentIds`), not the bytes.
 */
import type { ApiResponse } from '@qlan-ro/mainframe-types';
import { apiBase, postJson } from './http';

export interface UploadAttachmentItem {
  name: string;
  mediaType: string;
  sizeBytes: number;
  kind: 'image' | 'file';
  data: string; // base64 (no data: prefix)
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
  const json = await postJson<ApiResponse<{ attachments: SavedAttachment[] }>>(
    `${apiBase(port)}/api/chats/${chatId}/attachments`,
    { attachments },
  );
  if (!json.success) throw new Error(json.error);
  return json.data.attachments.map((a) => a.id);
}
