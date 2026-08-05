/**
 * The native assistant-ui `AttachmentAdapter` (registered at the runtime's
 * `adapters.attachments`). Reads a file into a data URL as a pending image/
 * document part; the actual daemon upload happens on send in the controller.
 *
 * Ported from the desktop adapter. The native composer swallows a rejected
 * `add()` (the dropzone only `console.error`s it; the button path doesn't catch
 * at all), so we surface the >5 MB rejection ourselves via `toast.error` before
 * re-throwing — otherwise an oversized drop fails with no user signal. Desktop
 * showed an inline error band; we reuse the app-wide toaster (M1) instead.
 */
import type { AttachmentAdapter, PendingAttachment, CompleteAttachment, AppendMessage } from '@assistant-ui/react';
import { mfToast } from '@/lib/toast';
import type { UploadAttachmentItem } from '../../../lib/api/attachments';

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

/**
 * Maps CompleteAttachment items (stored as data URLs) to the upload payload the
 * daemon expects. Lives here because this module owns the data-URL format.
 *
 * `sizeBytes` and `kind` are omitted — the daemon route derives both from the
 * `mediaType` and uploaded bytes when the fields are absent (Zod marks them
 * optional), so we skip the brittle client-side *3/4 base64 math.
 */
export function toUploadItems(attachments: AppendMessage['attachments']): UploadAttachmentItem[] {
  const items: UploadAttachmentItem[] = [];
  for (const att of attachments ?? []) {
    const part = att.content?.[0];
    const dataUrl = part?.type === 'image' ? part.image : part?.type === 'text' ? part.text : undefined;
    const m = dataUrl ? /^data:([^;]+);base64,(.*)$/.exec(dataUrl) : null;
    if (!m) continue;
    items.push({
      name: att.name,
      mediaType: m[1]!,
      data: m[2]!,
    });
  }
  return items;
}

export function createAttachmentAdapter(): AttachmentAdapter {
  return {
    accept: ACCEPT_ALL,
    async add({ file }) {
      if (file.size > MAX_SIZE) {
        const message = `"${file.name}" is too large. Max file size is ${FILE_SIZE_LIMIT_MB}MB.`;
        mfToast.error(message);
        throw new Error(message);
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
      return toCompleteAttachment(attachment);
    },
  };
}

/**
 * The adapter never does real network I/O on `send` (the daemon upload
 * happens later, in the controller) — resolving a pending attachment is just
 * this status flip. Exported so `use-submit-composition.ts` can produce the
 * `CompleteAttachment[]` the native `append()` type requires without an
 * adapter round-trip (composer.send() is bypassed there — see its docstring).
 *
 * The `File` rides through the flip so a failed send can re-add the exact same
 * files to the composer (use-chat-thread-runtime's restore) without stashing
 * the bytes anywhere.
 */
function isCompleteAttachment(attachment: PendingAttachment | CompleteAttachment): attachment is CompleteAttachment {
  return attachment.status.type === 'complete';
}

export function toCompleteAttachment(attachment: PendingAttachment | CompleteAttachment): CompleteAttachment {
  if (isCompleteAttachment(attachment)) return attachment;
  return {
    id: attachment.id,
    type: attachment.type,
    name: attachment.name,
    contentType: attachment.contentType,
    content: attachment.content ?? [],
    status: { type: 'complete' },
    ...(attachment.file ? { file: attachment.file } : {}),
  };
}
