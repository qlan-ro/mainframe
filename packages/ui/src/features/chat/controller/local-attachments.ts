/**
 * Local attachment previews — the bytes the composer already holds for a
 * send, kept so the turn shows its attachments at once. Without them the
 * optimistic pending waits for upload + the daemon's echo, and a queued turn
 * waits for the CLI to dequeue it, before any thumbnail appears.
 *
 * The projection mirrors what `convert-acp-user` builds from the confirmed
 * echo — images as plain image parts, everything else as a native file
 * attachment sized via `attachmentPreviews` — so nothing jumps on reconcile.
 */
import type { CompleteAttachment, ThreadUserMessagePart } from '@assistant-ui/react';
import type { UploadAttachmentItem } from '../../../lib/api/attachments';
import type { MainframeMessageMeta } from '../view-model/message-meta';

export type LocalAttachmentPreview = Pick<UploadAttachmentItem, 'name' | 'mediaType' | 'data'>;

export interface LocalAttachmentProjection {
  imageParts: ThreadUserMessagePart[];
  attachments: CompleteAttachment[];
  attachmentPreviews?: MainframeMessageMeta['attachmentPreviews'];
}

function decodedSize(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function projectLocalAttachments(previews: readonly LocalAttachmentPreview[]): LocalAttachmentProjection {
  const images = previews.filter((p) => p.mediaType.startsWith('image/'));
  const files = previews.filter((p) => !p.mediaType.startsWith('image/'));
  return {
    imageParts: images.map((p) => ({ type: 'image', image: `data:${p.mediaType};base64,${p.data}` })),
    attachments: files.map((p) => ({
      id: p.name,
      type: 'file',
      name: p.name,
      contentType: p.mediaType,
      content: [],
      status: { type: 'complete' },
    })),
    ...(files.length > 0 && {
      attachmentPreviews: files.map((p) => ({
        name: p.name,
        kind: 'file' as const,
        sizeBytes: decodedSize(p.data),
        mediaType: p.mediaType,
      })),
    }),
  };
}

/** Pair upload items with the daemon ids `uploadAttachments` returned (same order). */
export function previewsById(
  ids: readonly string[],
  items: readonly LocalAttachmentPreview[],
): Record<string, LocalAttachmentPreview> {
  return Object.fromEntries(
    ids.flatMap((id, i) =>
      items[i] ? [[id, { name: items[i].name, mediaType: items[i].mediaType, data: items[i].data }]] : [],
    ),
  );
}

/**
 * Drop the previews of turns that left the queue (dequeued or cancelled):
 * ids the previous snapshot referenced and the next one doesn't. Ids no
 * snapshot has carried yet stay — the queued acceptance can land before
 * the snapshot that lists it.
 */
export function pruneQueuedPreviews(
  previews: Readonly<Record<string, LocalAttachmentPreview>>,
  before: readonly { attachmentIds?: string[] }[],
  after: readonly { attachmentIds?: string[] }[],
): Readonly<Record<string, LocalAttachmentPreview>> {
  const kept = new Set(after.flatMap((ref) => ref.attachmentIds ?? []));
  const gone = before.flatMap((ref) => ref.attachmentIds ?? []).filter((id) => !kept.has(id) && id in previews);
  if (gone.length === 0) return previews;
  const next = { ...previews };
  for (const id of gone) delete next[id];
  return next;
}
