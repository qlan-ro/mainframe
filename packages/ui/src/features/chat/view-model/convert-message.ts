/**
 * Pure DisplayMessage → ThreadMessageLike translator (go-native projection).
 *
 * The top-level switch is thin: assistant content is delegated to the shared
 * recursive `mapAssistantBlocks` (WS14c invariant, \0 sentinel, uniqueId dedup,
 * ≥1-part fallback). Every message rides its daemon-derived data under the ONE
 * `metadata.custom.mainframe` contract (see message-meta.ts); the native
 * `metadata.timing` is the only separate field.
 *
 * Native part model: tool_group → flat tool-calls (grouped client-side) ·
 * task_group → a `Task` tool-call carrying `messages` · task_progress →
 * `_TaskProgress` card · image → native image part.
 */
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { DisplayMessage, DisplayContent } from '@qlan-ro/mainframe-types';
import { mapAssistantBlocks, PERMISSION_PLACEHOLDER, buildAssistantMainframeMeta } from './map-assistant-blocks';
import { type ContentPart, ensureNonEmpty } from './content';
import type { MainframeMessageMeta } from './message-meta';
import { parseSandboxCaptureBlock, type CaptureRow } from './parse-captures';
import { parseReviewComment } from './parse-review-comment';

export { PERMISSION_PLACEHOLDER };

/** Wraps a mainframe payload in the message `metadata.custom.mainframe` envelope. */
function withMainframe(
  extra: Record<string, unknown>,
  mf: MainframeMessageMeta,
): { metadata: Record<string, unknown> } {
  return { metadata: { ...extra, custom: { mainframe: mf } } };
}

/**
 * Safely extract the user-turn mainframe fields from raw daemon message metadata,
 * instead of blind-casting the whole object. Each field is type-checked, so a
 * malformed/unexpected daemon payload yields `{}` rather than corrupt meta the UI
 * then reads (e.g. a non-string `error` rendering a bogus failed-send state).
 */
function coerceUserMeta(metadata: unknown): MainframeMessageMeta {
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

export function convertMessage(message: DisplayMessage): ThreadMessageLike {
  const base = { id: message.id, createdAt: new Date(message.timestamp) };

  switch (message.type) {
    case 'user': {
      const mf: Record<string, unknown> = { ...coerceUserMeta(message.metadata) };

      // The capture sentinel decides image routing, and it always rides the
      // message's (first) text block — parse it up front so images that follow
      // become context-carrying native attachments instead of plain parts.
      const captureRows: CaptureRow[] | null = (() => {
        for (const c of message.content) {
          if (c.type === 'text' && c.text) {
            const sandbox = parseSandboxCaptureBlock(c.text);
            if (sandbox) return sandbox.rows;
          }
        }
        return null;
      })();
      if (captureRows) mf.captures = captureRows;

      // Build content parts (text rest + non-capture images) and, for a capture
      // message, the capture images as NATIVE image attachments. Captures render
      // through assistant-ui's clickable attachment tile (with their selector
      // context); regular images stay plain image parts (InlineImageThumbs).
      const parts: ContentPart[] = [];
      type AttachmentImagePart = { type: 'image'; image: string };
      const captureImageAttachments: Array<{
        id: string;
        type: 'image';
        name: string;
        contentType: string;
        content: AttachmentImagePart[];
        status: { type: 'complete' };
      }> = [];
      let captureImageIndex = 0;
      for (const c of message.content) {
        if (c.type === 'text' && c.text) {
          const sandbox = parseSandboxCaptureBlock(c.text);
          if (sandbox) {
            if (sandbox.rest) parts.push({ type: 'text', text: sandbox.rest });
            continue;
          }
          // Diff-review comments ("Diff of `file` … At line N: …"): the
          // ReviewCommentCard renders the whole message, so the raw text part
          // is dropped. Strict parse — a non-matching shape stays plain text.
          const review = parseReviewComment(c.text);
          if (review) {
            mf.reviewComment = review;
            continue;
          }
          parts.push({ type: 'text', text: c.text });
          continue;
        }
        if (c.type === 'image') {
          const dataUrl = `data:${c.mediaType};base64,${c.data}`;
          if (captureRows) {
            // Name from the matching capture row (by order); the renderer looks
            // up the selector/annotation from mf.captures by this name.
            const name = captureRows[captureImageIndex]?.imageName ?? `capture-${captureImageIndex + 1}.png`;
            captureImageIndex += 1;
            captureImageAttachments.push({
              id: name,
              type: 'image',
              name,
              contentType: c.mediaType,
              content: [{ type: 'image', image: dataUrl }],
              status: { type: 'complete' },
            });
          } else {
            parts.push({ type: 'image', image: dataUrl });
          }
        }
      }

      // Native FILE attachments: kind==='file' previews + replay-parsed
      // attachedFiles (name-only), deduped by name. contentType rides from the
      // preview's mediaType (replay files have none → octet-stream).
      const previews = (mf.attachmentPreviews ?? []) as ReadonlyArray<{
        name: string;
        kind: string;
        mediaType?: string;
      }>;
      const mediaTypeByName = new Map(previews.map((p) => [p.name, p.mediaType]));
      const rawMeta = message.metadata as Record<string, unknown> | undefined;
      const replayFiles = Array.isArray(rawMeta?.attachedFiles)
        ? (rawMeta.attachedFiles as Array<{ name?: unknown }>).flatMap((f) =>
            typeof f?.name === 'string' ? [f.name] : [],
          )
        : [];
      const fileNames = [...previews.filter((p) => p.kind === 'file').map((p) => p.name), ...replayFiles].filter(
        (name, i, arr) => arr.indexOf(name) === i,
      );
      const fileAttachments = fileNames.map((name) => ({
        id: name,
        type: 'file' as const,
        name,
        contentType: mediaTypeByName.get(name) ?? 'application/octet-stream',
        content: [] as AttachmentImagePart[],
        status: { type: 'complete' as const },
      }));

      const attachments = [...fileAttachments, ...captureImageAttachments];

      return {
        role: 'user',
        content: ensureNonEmpty(parts),
        ...base,
        ...(attachments.length > 0 && { attachments }),
        ...(Object.keys(mf).length > 0 && withMainframe({}, mf as MainframeMessageMeta)),
      };
    }

    case 'system': {
      const skillBlock = message.content.find(
        (c): c is DisplayContent & { type: 'skill_loaded' } => c.type === 'skill_loaded',
      );
      const textParts: ContentPart[] = message.content
        .filter((c): c is DisplayContent & { type: 'text' } => c.type === 'text')
        .map((c) => ({ type: 'text', text: c.text }));

      const mf: MainframeMessageMeta = {
        ...(message.content.some((c) => c.type === 'compaction') && { isCompacted: true }),
        ...(skillBlock && {
          skillLoaded: { skillName: skillBlock.skillName, path: skillBlock.path, content: skillBlock.content },
        }),
      };
      return {
        role: 'system',
        content: ensureNonEmpty(textParts),
        ...base,
        ...(Object.keys(mf).length > 0 && withMainframe({}, mf)),
      };
    }

    case 'assistant': {
      const { parts, groups, summaries } = mapAssistantBlocks(message.content);
      const costUsd = typeof message.metadata?.cost_usd === 'number' ? message.metadata.cost_usd : undefined;
      const turnMs = typeof message.metadata?.turnDurationMs === 'number' ? message.metadata.turnDurationMs : undefined;

      const mf: MainframeMessageMeta = {
        ...buildAssistantMainframeMeta(groups, summaries),
        ...(costUsd !== undefined && { cost: costUsd }),
      };
      const timing =
        turnMs !== undefined
          ? { timing: { streamStartTime: 0, totalStreamTime: turnMs, totalChunks: 0, toolCallCount: 0 } as const }
          : {};
      const hasMeta = Object.keys(mf).length > 0 || turnMs !== undefined;

      return {
        role: 'assistant',
        content: ensureNonEmpty(parts),
        ...base,
        ...(hasMeta && withMainframe(timing, mf)),
      };
    }

    case 'error': {
      const errorBlock = message.content.find((c): c is DisplayContent & { type: 'error' } => c.type === 'error');
      const errorText = errorBlock?.message?.trim() ? errorBlock.message : 'An error occurred';
      // Keep the text part (≥1-content-part invariant + a11y/fallback); the
      // `errorText` meta drives AssistantMessage's styled error block.
      return {
        role: 'assistant',
        content: [{ type: 'text', text: errorText }],
        ...base,
        ...withMainframe({}, { errorText }),
      };
    }

    case 'permission':
      return { role: 'assistant', content: [PERMISSION_PLACEHOLDER], ...base };

    default:
      return { role: 'assistant', content: [{ type: 'text', text: '' }], ...base };
  }
}
