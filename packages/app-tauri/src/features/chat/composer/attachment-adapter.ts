/**
 * The native assistant-ui `AttachmentAdapter` (registered at the runtime's
 * `adapters.attachments`). Reads a file into a data URL as a pending image/
 * document part; the actual daemon upload happens on send in the controller.
 *
 * Ported from the desktop adapter (only @assistant-ui/react + browser APIs).
 */
import type { AttachmentAdapter, PendingAttachment, CompleteAttachment } from '@assistant-ui/react';

export const FILE_SIZE_LIMIT_MB = 5;
const MAX_SIZE = FILE_SIZE_LIMIT_MB * 1024 * 1024;

// assistant-ui's fileMatchesAccept treats only the literal '*' as a universal
// wildcard; the MIME-style '*/*' rejects every file.
const ACCEPT_ALL = '*';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function createAttachmentAdapter(): AttachmentAdapter {
  return {
    accept: ACCEPT_ALL,
    async add({ file }) {
      if (file.size > MAX_SIZE) {
        throw new Error(`"${file.name}" is too large. Max file size is ${FILE_SIZE_LIMIT_MB}MB.`);
      }
      const dataUrl = await readFileAsDataUrl(file);
      const isImage = file.type.startsWith('image/');
      return {
        id: crypto.randomUUID(),
        type: isImage ? 'image' : 'document',
        name: file.name,
        contentType: file.type || 'application/octet-stream',
        file,
        content: isImage ? [{ type: 'image', image: dataUrl }] : [{ type: 'text', text: dataUrl }],
        status: { type: 'requires-action', reason: 'composer-send' },
      } satisfies PendingAttachment;
    },
    async remove() {},
    async send(attachment) {
      return {
        id: attachment.id,
        type: attachment.type as 'image' | 'document',
        name: attachment.name,
        contentType: attachment.contentType,
        content: attachment.content ?? [],
        status: { type: 'complete' },
      } satisfies CompleteAttachment;
    },
  };
}
