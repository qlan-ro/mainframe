/**
 * User-container branch of the ACP item converter — the legacy
 * `convert-message.ts` user path, fed from an item's ordered `ContentBlock`
 * list plus the raw `messageMeta` map the encoder passes through
 * (`ItemMeta.messageMeta` = `DisplayMessage.metadata`).
 *
 * Load-bearing behaviors preserved from the legacy converter:
 *  - the sandbox-capture sentinel decides image routing: capture images
 *    become native aui *attachments* (clickable tiles with their selector
 *    context, via `mf.captures`); regular images stay plain image parts;
 *  - diff-review comments parse into `mf.reviewComment` and drop their raw
 *    text part (ReviewCommentCard renders the whole message);
 *  - file attachments merge daemon previews with replay-parsed
 *    `attachedFiles`, deduped by name.
 */
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { ContentBlock } from '@qlan-ro/mainframe-types';
import { type ContentPart, ensureNonEmpty } from './content';
import type { MainframeMessageMeta } from './message-meta';
import { parseSandboxCaptureBlock, type CaptureRow } from './parse-captures';
import { parseReviewComment } from './parse-review-comment';

/**
 * Safely extract the user-turn mainframe fields from the raw metadata map,
 * instead of blind-casting the whole object. Each field is type-checked, so
 * a malformed payload yields `{}` rather than corrupt meta the UI then reads.
 */
export function coerceUserMeta(metadata: unknown): MainframeMessageMeta {
  if (typeof metadata !== 'object' || metadata === null) return {};
  const m = metadata as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof m.queued === 'boolean') out.queued = m.queued;
  if (typeof m.cleanText === 'string') out.cleanText = m.cleanText;
  if (typeof m.pending === 'boolean') out.pending = m.pending;
  if (typeof m.clientId === 'string') out.clientId = m.clientId;
  if (typeof m.error === 'string') out.error = m.error;
  if (
    typeof m.command === 'object' &&
    m.command !== null &&
    typeof (m.command as { name?: unknown }).name === 'string'
  ) {
    out.command = m.command;
  }
  // Attachment previews: keep only well-formed entries (name + valid kind).
  if (Array.isArray(m.attachments)) {
    const previews = m.attachments.flatMap((a: unknown) => {
      if (typeof a !== 'object' || a === null) return [];
      const e = a as Record<string, unknown>;
      if (typeof e.name !== 'string' || (e.kind !== 'image' && e.kind !== 'file')) return [];
      return [
        {
          name: e.name,
          kind: e.kind,
          ...(typeof e.sizeBytes === 'number' && { sizeBytes: e.sizeBytes }),
          ...(typeof e.mediaType === 'string' && { mediaType: e.mediaType }),
        },
      ];
    });
    if (previews.length > 0) out.attachmentPreviews = previews;
  }
  return out as MainframeMessageMeta;
}

type AttachmentImagePart = { type: 'image'; image: string };
type NativeAttachment = {
  id: string;
  type: 'image' | 'file';
  name: string;
  contentType: string;
  content: AttachmentImagePart[];
  status: { type: 'complete' };
};

function findCaptureRows(blocks: readonly ContentBlock[]): CaptureRow[] | null {
  for (const block of blocks) {
    if (block.type === 'text' && block.text) {
      const sandbox = parseSandboxCaptureBlock(block.text);
      if (sandbox) return sandbox.rows;
    }
  }
  return null;
}

/** Merge daemon previews (kind==='file') with replay-parsed attachedFiles, deduped by name. */
function fileAttachmentsFrom(mf: Record<string, unknown>, rawMeta: unknown): NativeAttachment[] {
  const previews = (mf.attachmentPreviews ?? []) as ReadonlyArray<{
    name: string;
    kind: string;
    mediaType?: string;
  }>;
  const mediaTypeByName = new Map(previews.map((p) => [p.name, p.mediaType]));
  const raw = rawMeta as Record<string, unknown> | undefined;
  const replayFiles = Array.isArray(raw?.attachedFiles)
    ? (raw.attachedFiles as Array<{ name?: unknown }>).flatMap((f) => (typeof f?.name === 'string' ? [f.name] : []))
    : [];
  const fileNames = [...previews.filter((p) => p.kind === 'file').map((p) => p.name), ...replayFiles].filter(
    (name, i, arr) => arr.indexOf(name) === i,
  );
  return fileNames.map((name) => ({
    id: name,
    type: 'file' as const,
    name,
    contentType: mediaTypeByName.get(name) ?? 'application/octet-stream',
    content: [] as AttachmentImagePart[],
    status: { type: 'complete' as const },
  }));
}

/** Build the user ThreadMessageLike from a user message item's blocks + raw metadata map. */
export function convertUserContainer(
  blocks: readonly ContentBlock[],
  rawMeta: unknown,
  base: { id: string; createdAt: Date },
): ThreadMessageLike {
  const mf: Record<string, unknown> = { ...coerceUserMeta(rawMeta) };

  // The capture sentinel decides image routing, and it always rides the
  // message's (first) text block — parse it up front so images that follow
  // become context-carrying native attachments instead of plain parts.
  const captureRows = findCaptureRows(blocks);
  if (captureRows) mf.captures = captureRows;

  const parts: ContentPart[] = [];
  const captureImageAttachments: NativeAttachment[] = [];
  let captureImageIndex = 0;
  for (const block of blocks) {
    if (block.type === 'text' && block.text) {
      const sandbox = parseSandboxCaptureBlock(block.text);
      if (sandbox) {
        if (sandbox.rest) parts.push({ type: 'text', text: sandbox.rest });
        continue;
      }
      // Diff-review comments ("Diff of `file` … At line N: …"): the
      // ReviewCommentCard renders the whole message, so the raw text part
      // is dropped. Strict parse — a non-matching shape stays plain text.
      const review = parseReviewComment(block.text);
      if (review) {
        mf.reviewComment = review;
        continue;
      }
      parts.push({ type: 'text', text: block.text });
      continue;
    }
    if (block.type === 'image') {
      const dataUrl = `data:${block.mimeType};base64,${block.data}`;
      if (captureRows) {
        // Name from the matching capture row (by order); the renderer looks
        // up the selector/annotation from mf.captures by this name.
        const name = captureRows[captureImageIndex]?.imageName ?? `capture-${captureImageIndex + 1}.png`;
        captureImageIndex += 1;
        captureImageAttachments.push({
          id: name,
          type: 'image',
          name,
          contentType: block.mimeType,
          content: [{ type: 'image', image: dataUrl }],
          status: { type: 'complete' },
        });
      } else {
        parts.push({ type: 'image', image: dataUrl });
      }
    }
  }

  const attachments = [...fileAttachmentsFrom(mf, rawMeta), ...captureImageAttachments];

  return {
    role: 'user',
    content: ensureNonEmpty(parts),
    ...base,
    ...(attachments.length > 0 && { attachments }),
    ...(Object.keys(mf).length > 0 && { metadata: { custom: { mainframe: mf } } }),
  };
}
